const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const util = require("util");
const exec = util.promisify(require("child_process").exec);

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
      const { stdout = "", stderr = "" } = await exec(cmd);
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
    process.chdir(repoPath);

    if (branchName) {
      await run(`git checkout -B ${branchName}`);
    }

    await run(`npm ${command} ${packages.join(" ")}`);
    await run("git add package.json package-lock.json");

    const commitPrefix = command === "install" ? "Install" : "Remove";
    try {
      await run(
        `git commit -m "${commitPrefix}: ${packages.join(", ")}" --no-verify`
      );
    } catch (commitErr) {
      const output = commitErr.stdout?.toString() || "";
      if (
        output.includes("nothing to commit") ||
        output.includes("no changes added to commit")
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

    if (!skipPush) {
      await run(`git push --set-upstream origin ${branchName} --no-verify`);
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
