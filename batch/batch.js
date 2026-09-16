#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Command } = require("commander");
const { printSummary } = require("../printSummary");
const cliProgress = require("cli-progress");
const pLimit = require("p-limit").default;
const { processRepo } = require("../processRepo");
const {
  DEFAULT_BASE_BRANCH,
  runCmd,
  loadConfig: loadConfigUtil,
  resolveBaseBranch,
  filterRepos: filterReposUtil,
  getExecutionModeMessage,
  getRepoInfo,
  ensureLogsDir,
  checkResults,
  generateExecLogContent,
} = require("../utils/utils");

const program = new Command();

// ============================================================================
// CLI Wrappers (handle process.exit for CLI usage)
// ============================================================================

/**
 * Load config with CLI error handling
 */
function loadConfig() {
  try {
    return loadConfigUtil();
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}

/**
 * Filter repos with CLI error handling
 */
function filterRepos(repos, only) {
  try {
    const { matched, unknown } = filterReposUtil(repos, only);
    if (unknown.length) {
      console.warn(
        `⚠️ Warning: these names from --only were not found and will be ignored: ${unknown.join(", ")}`,
      );
    }
    return matched;
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}

/**
 * Create a progress bar with standard configuration
 */
function createProgressBar(emoji = "📦") {
  return new cliProgress.SingleBar(
    {
      format: `${emoji} {bar} {percentage}% | {value}/{total} | {repo}`,
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  );
}

/**
 * Log execution mode (parallel vs sequential)
 */
function logExecutionMode(parallel, concurrentCount) {
  console.log(`\n${getExecutionModeMessage(parallel, concurrentCount)}\n`);
}

/**
 * Cleanup and exit with appropriate code
 */
function finishAndExit(bar, results, failCheck) {
  try {
    bar.stop();
  } catch (e) {
    /* noop */
  }

  printSummary(results);

  const { exitCode } = checkResults(results, failCheck);

  try {
    process.stdin.pause();
  } catch (e) {
    /* noop */
  }

  setImmediate(() => process.exit(exitCode));
}

program
  .name("batch")
  .description(
    "Bulk operations across multiple repos: install/remove npm packages or execute any shell command",
  )
  .version("1.0.0")
  .option(
    "--only <names>",
    "Comma-separated list of repo names/paths (as listed in repos.json) to process only",
  );

program
  .command("install")
  .alias("i")
  .description("Install packages in all repos")
  .argument("<packages...>", "Packages to install")
  .option("--dry-run", "Simulate the actions without executing commands")
  .option("--skip-push", "Do everything except git push")
  .option("--parallel", "Run tasks in parallel")
  .option("--verbose", "Enable verbose logging in the terminal")
  .option(
    "--base-branch <name>",
    `Branch new branches are created from (default: ${DEFAULT_BASE_BRANCH})`,
  )
  .action(async (packages, options) => {
    const merged = { ...program.opts(), ...options };
    await handleRepos("install", packages, merged);
  });

program
  .command("remove")
  .alias("rm")
  .description("Remove packages from all repos")
  .argument("<packages...>", "Packages to remove")
  .option("--dry-run", "Simulate the actions without executing commands")
  .option("--skip-push", "Do everything except git push")
  .option("--parallel", "Run tasks in parallel")
  .option("--verbose", "Enable verbose logging in the terminal")
  .option(
    "--base-branch <name>",
    `Branch new branches are created from (default: ${DEFAULT_BASE_BRANCH})`,
  )
  .action(async (packages, options) => {
    const merged = { ...program.opts(), ...options };
    await handleRepos("uninstall", packages, merged);
  });

program
  .command("exec")
  .alias("run")
  .description("Execute any shell command in all repos")
  .argument("<command...>", "Command to execute (quote if it contains spaces)")
  .option("--dry-run", "Simulate the actions without executing commands")
  .option("--parallel", "Run tasks in parallel")
  .option("--verbose", "Enable verbose logging in the terminal")
  .action(async (commandParts, options) => {
    const merged = { ...program.opts(), ...options };
    await handleExec(commandParts, merged);
  });

program.parse(process.argv);

async function handleRepos(
  command,
  packages,
  { dryRun, skipPush, parallel, verbose, only, baseBranch },
) {
  const results = [];
  const { basePath, repos, config } = loadConfig();

  if (!packages || !packages.length) {
    console.error("❌ You must specify at least one package.");
    process.exit(1);
  }

  const selected = filterRepos(repos, only);
  const bar = createProgressBar("📦");
  const concurrentCount = parallel ? 5 : 1;

  logExecutionMode(parallel, concurrentCount);

  if (!verbose) bar.start(selected.length, 0, { repo: "" });

  const limit = pLimit(concurrentCount);

  const localBranchExists = async (repoPath, branch) => {
    const cmd = `git -C "${repoPath}" show-ref --verify --quiet refs/heads/${branch}`;
    const res = await runCmd(cmd);
    return res.ok;
  };

  /**
   * Create `branchName` from the resolved base branch if it doesn't exist yet.
   * @param {string} repoPath - Absolute path to the repo
   * @param {string} branchName - Branch to ensure exists locally
   * @param {{remote: string, branch: string, ref: string}} base - Resolved base branch
   * @param {boolean} isVerbose - Print git failures to the terminal
   */
  const ensureBranchFromBase = async (
    repoPath,
    branchName,
    base,
    isVerbose,
  ) => {
    const run = (cmd) =>
      runCmd(`git -C "${repoPath}" ${cmd}`).then((res) => {
        if (!res.ok && isVerbose) {
          console.error(
            `[${repoPath}] ❌ ${cmd} failed:\n`,
            res.error || res.stdout,
          );
        }
        return res.ok;
      });

    // Check if branch already exists
    const exists = await run(`rev-parse --verify ${branchName}`);
    if (exists) {
      if (isVerbose)
        console.log(
          `[${repoPath}] ✅ Branch ${branchName} already exists locally`,
        );
      return true;
    }

    if (isVerbose)
      console.log(
        `[${repoPath}] 🆕 Creating branch '${branchName}' from ${base.ref}`,
      );

    // Refresh and validate the base branch before branch creation.
    const fetched = await run(`fetch ${base.remote} ${base.branch}`);
    if (!fetched) return false;

    const hasBase = await run(`rev-parse --verify refs/remotes/${base.ref}`);
    if (!hasBase) return false;

    // Create new local branch from the fresh base branch (without tracking)
    return await run(`checkout --no-track -b ${branchName} ${base.ref}`);
  };

  const tasks = selected.map((repo) =>
    limit(async () => {
      const { repoName, repoPath } = getRepoInfo(repo, basePath);

      if (!verbose) bar.update({ repo: repoName });

      if (!fs.existsSync(repoPath)) {
        results.push({
          repo: repoName,
          ok: false,
          error: `Path not found: ${repoPath}`,
        });
        if (verbose) console.error(`${repoName}: path not found: ${repoPath}`);
        if (!verbose) bar.increment();
        return;
      }

      // determine expected branch for this repo (from repos.json)
      const expectedBranch = repo.branch || repo.branchName || undefined;

      // base branch new branches are created from (CLI → repo → config → default)
      let base;
      try {
        base = resolveBaseBranch(repo, config, baseBranch);
      } catch (e) {
        results.push({ repo: repoName, ok: false, error: e.message });
        if (verbose) console.error(`${repoName}: ${e.message}`);
        if (!verbose) bar.increment();
        return;
      }

      if (expectedBranch) {
        let existsLocally = false;
        try {
          existsLocally = await localBranchExists(repoPath, expectedBranch);
        } catch (e) {
          existsLocally = false;
        }

        if (!existsLocally) {
          if (verbose)
            console.log(
              `${repoName}: branch ${expectedBranch} not found locally — creating it locally`,
            );

          if (dryRun) {
            results.push({
              repo: repoName,
              ok: true,
              dryRun: true,
              info: `Would create branch ${expectedBranch} from ${base.ref} after fetching remote refs`,
            });
            if (!verbose) bar.increment();
            return;
          }

          const created = await ensureBranchFromBase(
            repoPath,
            expectedBranch,
            base,
            verbose,
          );

          if (!created) {
            results.push({
              repo: repoName,
              ok: false,
              error: `branch ${expectedBranch} still not present after attempted creation`,
            });
            if (verbose)
              console.error(
                `${repoName}: failed to create branch ${expectedBranch}`,
              );
            if (!verbose) bar.increment();
            return;
          }
        }
      }

      // call processRepo
      try {
        if (dryRun) {
          results.push({
            repo: repoName,
            ok: true,
            dryRun: true,
            info: `Would run processRepo for ${repoName}`,
          });
          if (!verbose) bar.increment();
          return;
        }

        await processRepo(
          repo,
          command,
          packages,
          { dryRun, skipPush, bar, verbose, base },
          basePath,
          results,
        );
      } catch (err) {
        results.push({ repo: repoName, ok: false, error: err.message || err });
      }
    }),
  );

  try {
    await Promise.all(tasks);
  } finally {
    finishAndExit(bar, results, (r) => r.status?.includes("Error"));
  }
}

async function handleExec(commandParts, { dryRun, parallel, verbose, only }) {
  const results = [];
  const prLinks = [];
  const command = commandParts.join(" ");
  const isPrCreate = /\bgh\s+pr\s+create\b/.test(command);
  const { basePath, repos } = loadConfig();
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (!command) {
    console.error("❌ You must specify a command to execute.");
    process.exit(1);
  }

  const selected = filterRepos(repos, only);
  const bar = createProgressBar("🚀");
  const concurrentCount = parallel ? 5 : 1;
  const logsDir = ensureLogsDir();

  console.log(`\n📋 Command: ${command}`);
  logExecutionMode(parallel, concurrentCount);

  if (!verbose) bar.start(selected.length, 0, { repo: "" });

  const limit = pLimit(concurrentCount);

  const tasks = selected.map((repo) =>
    limit(async () => {
      const { repoName, repoPath } = getRepoInfo(repo, basePath);

      if (!verbose) bar.update({ repo: repoName });

      if (!fs.existsSync(repoPath)) {
        results.push({
          name: repoName,
          status: "❌ Error",
          message: `Path not found: ${repoPath}`,
        });
        if (verbose) console.error(`${repoName}: path not found: ${repoPath}`);
        if (!verbose) bar.increment();
        return;
      }

      if (dryRun) {
        results.push({
          name: repoName,
          status: "☑️ DRY RUN",
          message: `Would execute: ${command}`,
        });
        if (verbose) console.log(`${repoName}: would execute: ${command}`);
        if (isPrCreate) {
          prLinks.push({
            repo: repoName,
            prLink: `[dry-run] https://github.com/<owner>/${repoName}/pull/<n>`,
          });
        }
        if (!verbose) bar.increment();
        return;
      }

      // Execute the command in the repo directory
      const res = await runCmd(command, { cwd: repoPath });

      // Write log file
      const logFile = path.resolve(logsDir, `${repoName}-exec-${runStamp}.log`);
      const logContent = generateExecLogContent(command, repoPath, res);
      fs.writeFileSync(logFile, logContent, "utf8");

      if (verbose) {
        console.log(`\n--- ${repoName} ---`);
        if (res.stdout) console.log(res.stdout);
        if (res.stderr) console.error(res.stderr);
      }

      if (res.ok) {
        results.push({
          name: repoName,
          status: "✅ Success",
          message: `Executed successfully (log: ${logFile})`,
        });

        if (isPrCreate) {
          const prLink = (res.stdout.match(/https?:\/\/\S*\/pull\/\d+/) ||
            [])[0];
          if (prLink) prLinks.push({ repo: repoName, prLink });
        }
      } else {
        results.push({
          name: repoName,
          status: "❌ Error",
          message: `${res.error?.split("\n")[0] || "Command failed"} (log: ${logFile})`,
        });
      }

      if (!verbose) bar.increment();
    }),
  );

  try {
    await Promise.all(tasks);
  } finally {
    // Stop the progress bar before printing so its async redraw
    // doesn't overwrite the PR links / summary output.
    try {
      bar.stop();
    } catch (e) {
      /* noop */
    }

    if (isPrCreate && prLinks.length) {
      console.log("\n🔗 Pull requests:");
      for (const { repo, prLink } of prLinks) {
        console.log(`${repo} ${prLink}`);
      }
    }
    finishAndExit(bar, results, (r) => r.status.includes("Error"));
  }
}
