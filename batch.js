#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Command } = require("commander");
const { printSummary } = require("./printSummary");
const cliProgress = require("cli-progress");
const pLimit = require("p-limit").default;
const { processRepo } = require("./processRepo");
const util = require("util");
const exec = require("child_process").exec;
const execP = util.promisify(exec);

const program = new Command();

program
  .name("batch")
  .description(
    "Bulk operations across multiple repos: install/remove npm packages or execute any shell command"
  )
  .version("1.0.0")
  .option(
    "--only <names>",
    "Comma-separated list of repo names/paths (as listed in repos.json) to process only"
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
  { dryRun, skipPush, parallel, verbose, only }
) {
  const results = [];

  let raw;
  try {
    raw = fs.readFileSync("repos.json", "utf-8");
  } catch (e) {
    console.error("❌ Could not read repos.json:", e.message);
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    console.error("❌ repos.json is not valid JSON:", e.message);
    process.exit(1);
  }

  const basePath = config.basePath;
  const repos = config.repositories || [];

  if (!packages || !packages.length) {
    console.error("❌ You must specify at least one package.");
    process.exit(1);
  }

  if (!basePath) {
    console.error('❌ Missing "basePath" in repos.json');
    process.exit(1);
  }

  // --only filtering
  let selected = repos;
  if (only) {
    const onlyList = String(only)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!onlyList.length) {
      console.error("❌ --only provided but no repo names parsed");
      process.exit(1);
    }
    const matched = repos.filter(
      (r) => onlyList.includes(r.name) || onlyList.includes(r.path)
    );
    const foundNames = new Set(matched.map((r) => r.name || r.path));
    const unknown = onlyList.filter((n) => !foundNames.has(n));
    if (!matched.length) {
      console.error(
        `❌ None of the names passed to --only matched repos.json: ${onlyList.join(
          ","
        )}`
      );
      process.exit(1);
    }
    if (unknown.length)
      console.warn(
        `⚠️ Warning: these names from --only were not found and will be ignored: ${unknown.join(
          ", "
        )}`
      );
    selected = matched;
  }

  const bar = new cliProgress.SingleBar(
    {
      format: "📦 {bar} {percentage}% | {value}/{total} | {repo}",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  const concurrentCount = parallel ? 5 : 1;
  console.warn(
    `\n\r ${
      parallel ? "⚡ Running in parallel mode" : "🐢 Running in sequential mode"
    }${parallel ? `: concurrent tasks limit is ${concurrentCount}` : ""}\n\r`
  );

  if (!verbose) bar.start(selected.length, 0, { repo: "" });

  const limit = pLimit(concurrentCount);

  const runCmd = async (cmd, execOpts = {}) => {
    const optsWithBuffer = { maxBuffer: 10 * 1024 * 1024, ...execOpts };
    try {
      const r = await execP(cmd, optsWithBuffer);
      return { ok: true, stdout: r.stdout || "", stderr: r.stderr || "" };
    } catch (err) {
      return {
        ok: false,
        stdout: err.stdout || "",
        error: err.stderr || err.message,
      };
    }
  };

  const localBranchExists = async (repoPath, branch) => {
    const cmd = `git -C "${repoPath}" show-ref --verify --quiet refs/heads/${branch}`;
    const res = await runCmd(cmd);
    return res.ok;
  };

  const ensureBranchFromLocalMain = async (repoPath, branchName, verbose) => {
    const run = (cmd) =>
      runCmd(`git -C "${repoPath}" ${cmd}`).then((res) => {
        if (!res.ok && verbose) {
          console.error(
            `[${repoPath}] ❌ ${cmd} failed:\n`,
            res.error || res.stdout
          );
        }
        return res.ok;
      });

    // Check if branch already exists
    const exists = await run(`rev-parse --verify ${branchName}`);
    if (exists) {
      if (verbose)
        console.log(
          `[${repoPath}] ✅ Branch ${branchName} already exists locally`
        );
      return true;
    }

    if (verbose)
      console.log(
        `[${repoPath}] 🆕 Creating branch '${branchName}' from local main`
      );

    // Fetch remote refs
    await run(`fetch origin`);

    // Fast-forward local main to match origin/main (but don't checkout it)
    await run(`fetch origin main`);
    await run(`branch --force main origin/main`);

    // Create new local branch from updated main (without tracking)
    return await run(`checkout --no-track -b ${branchName} main`);
  };

  const tasks = selected.map((repo) =>
    limit(async () => {
      const repoName = repo.name || repo.path || JSON.stringify(repo);
      const repoPath = path.resolve(
        basePath,
        repo.path || repo.name || repoName
      );

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
              `${repoName}: branch ${expectedBranch} not found locally — creating it locally`
            );

          if (dryRun) {
            results.push({
              repo: repoName,
              ok: true,
              dryRun: true,
              info: `Would create branch ${expectedBranch} after fetching remote refs`,
            });
            if (!verbose) bar.increment();
            return;
          }

          const created = await ensureBranchFromLocalMain(
            repoPath,
            expectedBranch,
            verbose
          );

          if (!created) {
            results.push({
              repo: repoName,
              ok: false,
              error: `branch ${expectedBranch} still not present after attempted creation`,
            });
            if (verbose)
              console.error(
                `${repoName}: failed to create branch ${expectedBranch}`
              );
            if (!verbose) bar.increment();
            return;
          }
        }
      }

      // call processRepo
      try {
        if (dryRun) {
          // gather the commands processRepo would run by calling it in a mode it supports
          // but to keep this simple, we just note dry-run and skip calling processRepo
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
          { dryRun, skipPush, bar, verbose },
          basePath,
          results
        );
      } catch (err) {
        results.push({ repo: repoName, ok: false, error: err.message || err });
      }
    })
  );

  try {
    await Promise.all(tasks);
  } finally {
    try {
      bar.stop();
    } catch (e) {
      /** nada */
    }

    printSummary(results);

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      try {
        process.stdin.pause();
      } catch (e) {}
      setImmediate(() => process.exit(2));
    }

    try {
      process.stdin.pause();
    } catch (e) {}
    setImmediate(() => process.exit(0));
  }
}

async function handleExec(commandParts, { dryRun, parallel, verbose, only }) {
  const results = [];

  // Join command parts into a single command string
  const command = commandParts.join(" ");

  let raw;
  try {
    raw = fs.readFileSync("repos.json", "utf-8");
  } catch (e) {
    console.error("❌ Could not read repos.json:", e.message);
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    console.error("❌ repos.json is not valid JSON:", e.message);
    process.exit(1);
  }

  const basePath = config.basePath;
  const repos = config.repositories || [];

  if (!command) {
    console.error("❌ You must specify a command to execute.");
    process.exit(1);
  }

  if (!basePath) {
    console.error('❌ Missing "basePath" in repos.json');
    process.exit(1);
  }

  // --only filtering
  let selected = repos;
  if (only) {
    const onlyList = String(only)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!onlyList.length) {
      console.error("❌ --only provided but no repo names parsed");
      process.exit(1);
    }
    const matched = repos.filter(
      (r) => onlyList.includes(r.name) || onlyList.includes(r.path)
    );
    const foundNames = new Set(matched.map((r) => r.name || r.path));
    const unknown = onlyList.filter((n) => !foundNames.has(n));
    if (!matched.length) {
      console.error(
        `❌ None of the names passed to --only matched repos.json: ${onlyList.join(
          ","
        )}`
      );
      process.exit(1);
    }
    if (unknown.length)
      console.warn(
        `⚠️ Warning: these names from --only were not found and will be ignored: ${unknown.join(
          ", "
        )}`
      );
    selected = matched;
  }

  const bar = new cliProgress.SingleBar(
    {
      format: "🚀 {bar} {percentage}% | {value}/{total} | {repo}",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  const concurrentCount = parallel ? 5 : 1;
  console.log(`\n📋 Command: ${command}`);
  console.log(
    `${
      parallel ? "⚡ Running in parallel mode" : "🐢 Running in sequential mode"
    }${parallel ? `: concurrent tasks limit is ${concurrentCount}` : ""}\n`
  );

  if (!verbose) bar.start(selected.length, 0, { repo: "" });

  const limit = pLimit(concurrentCount);

  const runCmd = async (cmd, execOpts = {}) => {
    const optsWithBuffer = { maxBuffer: 10 * 1024 * 1024, ...execOpts };
    try {
      const r = await execP(cmd, optsWithBuffer);
      return { ok: true, stdout: r.stdout || "", stderr: r.stderr || "" };
    } catch (err) {
      return {
        ok: false,
        stdout: err.stdout || "",
        stderr: err.stderr || "",
        error: err.stderr || err.message,
        code: err.code,
      };
    }
  };

  // Create logs directory
  const logsDir = path.resolve(__dirname, "logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

  const tasks = selected.map((repo) =>
    limit(async () => {
      const repoName = repo.name || repo.path || JSON.stringify(repo);
      const repoPath = path.resolve(
        basePath,
        repo.path || repo.name || repoName
      );

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
        if (!verbose) bar.increment();
        return;
      }

      // Execute the command in the repo directory
      const res = await runCmd(command, { cwd: repoPath });

      // Write log file
      const logFile = path.resolve(logsDir, `${repoName}-exec.log`);
      const logContent = [
        `Command: ${command}`,
        `Directory: ${repoPath}`,
        `Exit code: ${res.ok ? 0 : res.code || 1}`,
        "",
        "--- stdout ---",
        res.stdout || "(empty)",
        "",
        "--- stderr ---",
        res.stderr || "(empty)",
      ].join("\n");
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
      } else {
        results.push({
          name: repoName,
          status: "❌ Error",
          message: `${res.error?.split("\n")[0] || "Command failed"} (log: ${logFile})`,
        });
      }

      if (!verbose) bar.increment();
    })
  );

  try {
    await Promise.all(tasks);
  } finally {
    try {
      bar.stop();
    } catch (e) {
      /** nada */
    }

    printSummary(results);

    const failed = results.filter((r) => r.status.includes("Error"));
    if (failed.length) {
      try {
        process.stdin.pause();
      } catch (e) {}
      setImmediate(() => process.exit(2));
    }

    try {
      process.stdin.pause();
    } catch (e) {}
    setImmediate(() => process.exit(0));
  }
}
