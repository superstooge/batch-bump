const fs = require("fs");
const path = require("path");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const simpleGit = require("simple-git");

async function processRepo(
  repo,
  command,
  packages,
  { dryRun, skipPush, bar, verbose },
  basePath,
  results
) {
  const repoPath = path.resolve(basePath, repo.name);
  const branchName = repo.branch;
  const git = simpleGit(repoPath);

  bar.increment({ repo: `${repo.name}::${branchName}` });

  const log = [];
  const logsDir = path.resolve(__dirname, "logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
  const logFile = path.resolve(logsDir, `${repo.name}.log`);

  const writeLog = () => {
    fs.writeFileSync(logFile, log.join("\n"), "utf8");
    return logFile;
  };

  const run = async (cmd) => {
    try {
      const { stdout = "", stderr = "" } = await exec(cmd, { cwd: repoPath });
      const out = [stdout, stderr].filter(Boolean).join("\n").trim();

      if (verbose && out) console.log(out);
      log.push(`$ ${cmd}\n${out}`);
      return out;
    } catch (err) {
      const stdout = err.stdout?.toString?.().trim?.() || "";
      const stderr = err.stderr?.toString?.().trim?.() || "";
      const out = [stdout, stderr].filter(Boolean).join("\n");
      const message = `❌ ${cmd} failed\n${out}`;
      if (verbose && out) console.error(message);
      log.push(`$ ${cmd}\n${out}`);
      throw err;
    }
  };

  if (dryRun) {
    results.push({
      name: repo.name,
      status: "☑️ DRY RUN",
      message: `Would ${command} ${packages.join(
        ", "
      )} on branch ${branchName}`,
    });
    return;
  }

  try {
    // Clean up stale git lock files
    const lockFile = path.join(repoPath, ".git", "index.lock");
    if (fs.existsSync(lockFile)) {
      try {
        fs.unlinkSync(lockFile);
        if (verbose) console.warn(`🧹 Removed stale lock in ${repo.name}`);
      } catch (e) {
        console.error(`❌ Could not remove lock in ${repo.name}: ${e.message}`);
      }
    }

    // Checkout or create branch
    if (branchName) {
      await git.checkout(["-B", branchName]);
      log.push(`$ git checkout -B ${branchName}`);
    }

    // Install or remove packages
    await run(`npm ${command} ${packages.join(" ")}`);

    // Add files
    await git.add(["package.json", "package-lock.json"]);
    log.push("$ git add package.json package-lock.json");

    // Commit changes
    const commitMessage = `${
      command === "install" ? "Install" : "Remove"
    }: ${packages.join(", ")}`;
    try {
      await git.commit(commitMessage, { "--no-verify": null });
      log.push(`$ git commit -m \"${commitMessage}\" --no-verify`);
    } catch (commitErr) {
      const message = commitErr.message || "";
      if (
        message.includes("nothing to commit") ||
        message.includes("no changes added to commit")
      ) {
        const file = writeLog();
        if (verbose)
          console.warn(
            `⚠️  No changes to commit in ${repo.name} (log: ${file})`
          );
        results.push({
          name: repo.name,
          status: "⚠️ Skipped",
          message: `No changes to commit (log: ${path.basename(file)})`,
        });
        return;
      }
      throw commitErr;
    }

    // Push changes if not skipped
    if (!skipPush) {
      await git.push("origin", branchName, { "--no-verify": null });
      log.push(`$ git push --set-upstream origin ${branchName} --no-verify`);
    } else {
      log.push("[skip-push] Skipped pushing to remote");
    }

    const file = writeLog();
    if (verbose) console.log(`📄 Log saved to ${file}`);

    results.push({
      name: repo.name,
      status: "✅ Success",
      message: `Committed on ${branchName} (log: ${path.basename(file)})`,
    });
  } catch (err) {
    const file = writeLog();
    results.push({
      name: repo.name,
      status: "❌ Error",
      message: `${err.message.split("\n")[0]} (log: ${path.basename(file)})`,
    });
  }
}

module.exports = { processRepo };
