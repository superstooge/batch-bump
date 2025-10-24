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
  .description("Bulk install/remove npm packages across multiple repos")
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

  const ensureBranchExists = async (
    repoPath,
    branch,
    remote = "origin",
    verboseFlag = false
  ) => {
    if (verboseFlag) console.log(`${repoPath}: git fetch ${remote} --prune`);
    const f = await runCmd(`git -C "${repoPath}" fetch ${remote} --prune`);
    if (!f.ok) {
      if (verboseFlag)
        console.error(`${repoPath}: fetch failed:`, f.error || f.stdout);
      return false;
    }

    // local check
    const localCheck = await runCmd(
      `git -C "${repoPath}" show-ref --verify --quiet refs/heads/${branch}`
    );
    if (localCheck.ok) return true;

    // remote check: is there origin/branch?
    const remoteList = await runCmd(
      `git -C "${repoPath}" branch -r --list ${remote}/${branch}`
    );
    const remoteHasBranch =
      remoteList.ok && (remoteList.stdout || "").trim().length > 0;

    if (remoteHasBranch) {
      if (verboseFlag)
        console.log(
          `${repoPath}: creating local branch '${branch}' tracking ${remote}/${branch}`
        );
      const track = await runCmd(
        `git -C "${repoPath}" checkout --track -b ${branch} ${remote}/${branch}`
      );
      if (track.ok) return true;

      if (verboseFlag)
        console.warn(
          `${repoPath}: checkout --track failed, trying direct fetch into local branch`
        );
      const fetchRef = await runCmd(
        `git -C "${repoPath}" fetch ${remote} refs/heads/${branch}:refs/heads/${branch}`
      );
      if (!fetchRef.ok) {
        if (verboseFlag)
          console.error(
            `${repoPath}: fetch-ref failed:`,
            fetchRef.error || fetchRef.stdout
          );
        return false;
      }
      const co = await runCmd(`git -C "${repoPath}" checkout ${branch}`);
      if (co.ok) return true;
      if (verboseFlag)
        console.error(
          `${repoPath}: checkout after fetch-ref failed:`,
          co.error || co.stdout
        );
      return false;
    }

    // remote doesn't have the branch — create locally from origin/main if possible
    if (verboseFlag)
      console.log(
        `${repoPath}: remote doesn't have ${branch}; attempting to create from ${remote}/main`
      );
    await runCmd(
      `git -C "${repoPath}" fetch ${remote} main:refs/remotes/${remote}/main`
    ).catch(() => {});
    const fromOriginMain = await runCmd(
      `git -C "${repoPath}" checkout -b ${branch} ${remote}/main`
    );
    if (fromOriginMain.ok) return true;

    // last fallback: create from local main
    const fallback = await runCmd(
      `git -C "${repoPath}" checkout main && git -C "${repoPath}" checkout -b ${branch}`
    );
    if (fallback.ok) return true;

    if (verboseFlag)
      console.error(`${repoPath}: failed to create branch ${branch}`);
    return false;
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

          const created = await ensureBranchExists(
            repoPath,
            expectedBranch,
            repo.remote || "origin",
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
