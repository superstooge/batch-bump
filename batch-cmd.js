#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Command } = require("commander");
const { printSummary } = require("./printSummary");

const program = new Command();
const results = [];

program
  .name("batch")
  .description("Bulk install/remove npm packages across multiple repos")
  .version("1.0.0");

program
  .command("install")
  .alias("i")
  .description("Install packages in all repos")
  .argument("<packages...>", "Packages to install")
  .option("--dry-run", "Simulate the actions without executing them")
  .option("--skip-push", "Do everything except git push")
  .action((packages, options) => {
    handleRepos("install", packages, options);
  });

program
  .command("remove")
  .alias("rm")
  .description("Remove packages from all repos")
  .argument("<packages...>", "Packages to remove")
  .option("--dry-run", "Simulate the actions without executing them")
  .option("--skip-push", "Do everything except git push")
  .action((packages, options) => {
    handleRepos("uninstall", packages, options);
  });

program.parse(process.argv);

function handleRepos(command, packages, { dryRun, skipPush }) {
  const config = JSON.parse(fs.readFileSync("repos.json", "utf-8"));
  const basePath = config.basePath;

  if (!basePath) {
    console.error('❌ Missing "basePath" in repos.json');
    process.exit(1);
  }

  config.repositories.forEach((repo) => {
    const repoPath = path.resolve(basePath, repo.name);
    const branchName = repo.branch;

    console.log(`\n📦 Repo: ${repo.name}`);
    console.log(`📂 Path: ${repoPath}`);

    if (dryRun) {
      console.log(`🔍 DRY RUN: Would checkout/create branch "${branchName}"`);
      console.log(
        `🔍 DRY RUN: Would run "npm ${command} ${packages.join(" ")}"`
      );
      if (!skipPush) {
        console.log(`🔍 DRY RUN: Would push branch "${branchName}"`);
      } else {
        console.log(`🛑 Skipping push (flag --skip-push)`);
      }

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
        execSync(`git checkout -B ${branchName}`, { stdio: "inherit" });
      }

      execSync(`npm ${command} ${packages.join(" ")}`, { stdio: "inherit" });
      execSync("git add package.json package-lock.json", { stdio: "inherit" });

      const commitPrefix = command === "install" ? "Install" : "Remove";
      let commitOutput = "";

      try {
        commitOutput = execSync(
          `git commit -m "${commitPrefix}: ${packages.join(", ")}" --no-verify`,
          { encoding: "utf8" }
        );
        console.log(commitOutput.trim());
      } catch (commitErr) {
        const output = commitErr.stdout?.toString() || "";
        if (
          output.includes("nothing to commit") ||
          output.includes("no changes added to commit")
        ) {
          console.warn(`⚠️  No changes to commit in ${repo.name}`);
          results.push({
            name: repo.name,
            status: "⚠️ Skipped",
            message: "No changes to commit",
          });
          return;
        } else {
          throw commitErr;
        }
      }

      if (!skipPush) {
        execSync(`git push --set-upstream origin ${branchName} --no-verify`, {
          stdio: "inherit",
        });
      } else {
        console.log("🛑 Skipping push (flag --skip-push)");
      }

      results.push({
        name: repo.name,
        status: "✅ Success",
        message: `Committed on ${branchName}`,
      });

      console.log(`✅ Done with ${repo.name}`);
    } catch (err) {
      results.push({
        name: repo.name,
        status: "❌ Error",
        message: err.message.split("\n")[0],
      });

      console.error(`❌ Error in ${repo.name}: ${err.message}`);
    }
  });

  printSummary(results);
}
