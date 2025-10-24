#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Command } = require("commander");
const pLimit = require("p-limit").default;
const cliProgress = require("cli-progress");
const { exec } = require("child_process");
const util = require("util");
const execP = util.promisify(exec);

const program = new Command();

program
  .name("sync")
  .description(
    "Checkout a branch (default: main) and pull from remote for every repo in repos.json"
  )
  .option("--dry-run", "Show what would be executed without running commands")
  .option("--parallel", "Run tasks in parallel")
  .option("--verbose", "Print git output for each repo")
  .option("--branch <name>", "Branch to checkout/pull", "main")
  .option("--remote <name>", "Remote to pull from", "origin")
  .option(
    "--only <names>",
    "Comma-separated list of repo names (as listed in repos.json) to process only"
  )
  .parse(process.argv);

const opts = program.opts();

(async function main() {
  const raw = fs.readFileSync("repos.json", "utf8");
  const config = JSON.parse(raw);
  const basePath = config.basePath;
  const repos = config.repositories || [];

  if (!basePath) {
    console.error('❌ Missing "basePath" in repos.json');
    process.exit(1);
  }

  if (!repos.length) {
    console.error("❌ No repositories defined in repos.json");
    process.exit(1);
  }

  // handle --only filtering
  let selected = repos;
  if (opts.only) {
    const onlyList = opts.only
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!onlyList.length) {
      console.error("❌ --only provided but no repo names parsed");
      process.exit(1);
    }

    // match by name or path (flexible)
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

    if (unknown.length) {
      console.warn(
        `⚠️ Warning: these names from --only were not found and will be ignored: ${unknown.join(
          ", "
        )}`
      );
    }

    selected = matched;
  }

  const concurrent = opts.parallel ? 5 : 1;
  const limit = pLimit(concurrent);

  const bar = new cliProgress.SingleBar(
    {
      format: "🔁 {bar} {percentage}% | {value}/{total} | {repo}",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  if (!opts.verbose) {
    bar.start(selected.length, 0, { repo: "" });
  }

  const results = [];

  const runCmd = async (cmd, cwd) => {
    // execP runs in a shell; we prefix with -C when possible instead of changing cwd here
    try {
      const r = await execP(cmd, { cwd });
      return { ok: true, stdout: r.stdout, stderr: r.stderr };
    } catch (err) {
      return { ok: false, error: err.stderr || err.message };
    }
  };

  const taskFor = (repo) => async () => {
    const repoName = repo.path || repo.name || JSON.stringify(repo);
    const repoPath = path.resolve(basePath, repo.path || repo.name || repoName);
    const branch = opts.branch;
    const remote = opts.remote;

    if (!opts.verbose) bar.update({ repo: repoName });

    if (opts.dryRun) {
      results.push({
        repo: repoName,
        ok: true,
        dryRun: true,
        cmds: [
          `git -C "${repoPath}" fetch ${remote} --prune`,
          `git -C "${repoPath}" checkout ${branch}`,
          `git -C "${repoPath}" pull ${remote} ${branch}`,
        ],
      });
      if (opts.verbose)
        console.log(`(dry) ${repoName}: would run fetch -> checkout -> pull`);
      if (!opts.verbose) bar.increment();
      return;
    }

    // ensure path exists
    if (!fs.existsSync(repoPath)) {
      results.push({
        repo: repoName,
        ok: false,
        error: `Path not found: ${repoPath}`,
      });
      if (opts.verbose)
        console.error(`${repoName}: path not found: ${repoPath}`);
      if (!opts.verbose) bar.increment();
      return;
    }

    try {
      // fetch remote to ensure up-to-date refs
      if (opts.verbose) console.log(`${repoName}: git fetch ${remote} --prune`);
      const fetchRes = await runCmd(
        `git -C "${repoPath}" fetch ${remote} --prune`
      );
      if (!fetchRes.ok) throw new Error(fetchRes.error || "fetch failed");

      if (opts.verbose) console.log(`${repoName}: git checkout ${branch}`);
      const coRes = await runCmd(`git -C "${repoPath}" checkout ${branch}`);
      if (!coRes.ok) throw new Error(coRes.error || "checkout failed");

      if (opts.verbose)
        console.log(`${repoName}: git pull ${remote} ${branch}`);
      const pullRes = await runCmd(
        `git -C "${repoPath}" pull ${remote} ${branch}`
      );
      if (!pullRes.ok) throw new Error(pullRes.error || "pull failed");

      results.push({ repo: repoName, ok: true });
      if (opts.verbose) console.log(`${repoName}: synced ✅`);
    } catch (err) {
      results.push({ repo: repoName, ok: false, error: err.message || err });
      if (opts.verbose)
        console.error(`${repoName}: error ->`, err.message || err);
    } finally {
      if (!opts.verbose) bar.increment();
    }
  };

  const tasks = selected.map((r) => limit(taskFor(r)));

  try {
    await Promise.all(tasks);
  } finally {
    if (!opts.verbose) bar.stop();
    // summary
    const failed = results.filter((r) => !r.ok);
    const succeeded = results.filter((r) => r.ok);

    console.log("Summary:");
    console.log(`  ✅ succeeded: ${succeeded.length}`);
    console.log(`  ❌ failed:    ${failed.length}`);

    if (failed.length) {
      console.log("Failures:");
      failed.forEach((f) => {
        console.log(` - ${f.repo}: ${f.error}`);
      });
      process.exit(2);
    }

    process.exit(0);
  }
})();
