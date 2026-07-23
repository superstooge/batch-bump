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
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const repoPath = path.resolve(basePath, repo.name);
  const branchName = repo.branch;
  const git = simpleGit(repoPath);

  bar.increment({ repo: `${repo.name}::${branchName}` });

  const log = [];
  const logsDir = path.resolve(__dirname, "logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
  const logFile = path.resolve(logsDir, `${repo.name}-${runStamp}.log`);

  const writeLog = () => {
    fs.writeFileSync(logFile, log.join("\n"), "utf8");
    return logFile; // absolute path
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
      try {
        // If branch exists locally this will succeed and simply checkout
        await git.checkout(branchName);
        log.push(`$ git checkout ${branchName}`);
      } catch (checkoutErr) {
        // Branch doesn't exist locally — decide how to create it.
        try {
          // List local branches
          const local = await git.branchLocal();
          const hasLocal =
            local && Array.isArray(local.all) && local.all.includes(branchName);

          if (hasLocal) {
            // shouldn't reach here because git.checkout would have worked, but safe-guard
            await git.checkout(branchName);
            log.push(`$ git checkout ${branchName} (already present locally)`);
          } else {
            // Refresh remote refs before checking whether remote branch exists.
            await git.fetch("origin");
            log.push("$ git fetch origin");

            // Inspect remote branches (returns array like ['origin/HEAD', 'origin/main', 'origin/chore/test'])
            const remote = await git.branch(["-r"]);
            const remoteHas =
              remote &&
              Array.isArray(remote.all) &&
              remote.all.includes(`origin/${branchName}`);

            if (remoteHas) {
              // Create local branch that tracks origin/<branchName>
              await git.checkout([
                "--track",
                "-b",
                branchName,
                `origin/${branchName}`,
              ]);
              log.push(
                `$ git checkout --track -b ${branchName} origin/${branchName}`
              );
            } else {
              // Remote doesn't have it either — create from fresh origin/main.
              await git.fetch("origin", "main");
              log.push("$ git fetch origin main");

              await git.checkout(["--no-track", "-b", branchName, "origin/main"]);
              log.push(
                `$ git checkout --no-track -b ${branchName} origin/main`
              );
            }
          }
        } catch (createErr) {
          // Record the error and rethrow so outer try/catch handles it
          log.push(
            `$ git checkout/create ${branchName} failed: ${
              createErr.message || createErr
            }`
          );
          throw createErr;
        }
      }
    }

    // Install or remove packages
    await run(`pnpm ${command} ${packages.join(" ")}`);

    // Add files
    await git.add(["package.json", "pnpm-lock.yaml"]);
    log.push("$ git add package.json pnpm-lock.yaml");

    // Commit changes
    const commitMessage = `${
      command === "install" ? "Install" : "Remove"
    }: ${packages.join(", ")}`;
    try {
      await git.commit(commitMessage, { "--no-verify": null });
      log.push(`$ git commit -m "${commitMessage}" --no-verify`);
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
          // include absolute path and file:// URL
          message: `No changes to commit (log: ${file})`,
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
      // show absolute path and file:// URL so terminals/editors can link it
      message: `Committed on ${branchName} (log: ${file})`,
    });
  } catch (err) {
    const file = writeLog();

    results.push({
      name: repo.name,
      status: "❌ Error",
      message: `${
        err && err.message ? err.message.split("\n")[0] : String(err)
      } (log: ${file})`,
    });
  }
}

module.exports = { processRepo };
