#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Command } = require("commander");
const pLimit = require("p-limit").default;
const cliProgress = require("cli-progress");
const util = require("util");
const exec = require("child_process").exec;
const execP = util.promisify(exec);

const program = new Command();

program
  .name("sync")
  .description(
    "Fetch remote refs and pull the specified branch (default: main) for repos in repos.json — does NOT create branches"
  )
  .option("--dry-run", "Show what would be executed without running commands")
  .option(
    "--only <names>",
    "Comma-separated list of repo names/paths to process only"
  )
  .option("--branch <name>", "Branch to fetch/pull", "main")
  .option("--remote <name>", "Remote to use", "origin")
  .option("--parallel", "Run tasks in parallel")
  .option("--verbose", "Print git output for each repo")
  .parse(process.argv);

const opts = program.opts();

async function main() {
  let raw;
  try {
    raw = fs.readFileSync("repos.json", "utf8");
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

  if (!basePath) {
    console.error('❌ Missing "basePath" in repos.json');
    process.exit(1);
  }

  if (!repos.length) {
    console.error("❌ No repositories defined in repos.json");
    process.exit(1);
  }

  // --only filter
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

  if (!opts.verbose) bar.start(selected.length, 0, { repo: "" });

  const results = [];

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

  const branch = opts.branch;
  const remote = opts.remote;

  const tasks = selected.map((repo) =>
    limit(async () => {
      const repoName = repo.name || repo.path || JSON.stringify(repo);
      const repoPath = path.resolve(
        basePath,
        repo.path || repo.name || repoName
      );

      if (!opts.verbose) bar.update({ repo: repoName });

      if (opts.dryRun) {
        results.push({
          repo: repoName,
          ok: true,
          dryRun: true,
          cmds: [
            `git -C "${repoPath}" fetch ${remote} --prune`,
            `git -C "${repoPath}" checkout ${branch} (if exists locally)`,
            `git -C "${repoPath}" pull ${remote} ${branch} (if checked out)`,
          ],
        });
        if (opts.verbose)
          console.log(
            `(dry) ${repoName}: would fetch refs and attempt checkout/pull for ${branch}`
          );
        if (!opts.verbose) bar.increment();
        return;
      }

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
        if (opts.verbose)
          console.log(`${repoName}: git fetch ${remote} --prune`);
        const fetchRes = await runCmd(
          `git -C "${repoPath}" fetch ${remote} --prune`
        );
        if (!fetchRes.ok) {
          results.push({
            repo: repoName,
            ok: false,
            error: `fetch failed: ${fetchRes.error || fetchRes.stdout}`,
          });
          if (opts.verbose)
            console.error(
              `${repoName}: fetch failed:`,
              fetchRes.error || fetchRes.stdout
            );
          if (!opts.verbose) bar.increment();
          return;
        }

        if (opts.verbose)
          console.log(
            `${repoName}: attempting to checkout ${branch} (no creation by sync)`
          );
        const coRes = await runCmd(`git -C "${repoPath}" checkout ${branch}`);
        if (!coRes.ok) {
          if (opts.verbose) {
            console.warn(
              `${repoName}: branch '${branch}' not present locally — sync will not create it (by design).`
            );
            const remotes = await runCmd(
              `git -C "${repoPath}" branch -r --list`
            );
            if (remotes.ok)
              console.log(
                `${repoName}: remote branches:\n${remotes.stdout.trim()}`
              );
          }
          results.push({
            repo: repoName,
            ok: true,
            info: `fetched refs; branch ${branch} not present locally`,
          });
          if (!opts.verbose) bar.increment();
          return;
        }

        if (opts.verbose)
          console.log(`${repoName}: git pull ${remote} ${branch}`);
        const pullRes = await runCmd(
          `git -C "${repoPath}" pull ${remote} ${branch}`
        );
        if (!pullRes.ok) {
          results.push({
            repo: repoName,
            ok: false,
            error: `pull failed: ${pullRes.error || pullRes.stdout}`,
          });
          if (opts.verbose)
            console.error(
              `${repoName}: pull failed:`,
              pullRes.error || pullRes.stdout
            );
          if (!opts.verbose) bar.increment();
          return;
        }

        results.push({ repo: repoName, ok: true });
        if (opts.verbose) console.log(`${repoName}: synced ✅`);
      } catch (err) {
        results.push({ repo: repoName, ok: false, error: err.message || err });
        if (opts.verbose)
          console.error(`${repoName}: error ->`, err.message || err);
      } finally {
        if (!opts.verbose) bar.increment();
      }
    })
  );

  try {
    await Promise.all(tasks);
  } finally {
    try {
      bar.stop();
    } catch (e) {
      /** ignore */
    }

    const failed = results.filter((r) => !r.ok);
    const succeeded = results.filter((r) => r.ok);

    console.log("\nSummary:");
    console.log(`  ✅ succeeded: ${succeeded.length}`);
    console.log(`  ❌ failed:    ${failed.length}`);

    if (failed.length) {
      console.log("\nFailures:");
      failed.forEach((f) => console.log(` - ${f.repo}: ${f.error}`));
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

main();
