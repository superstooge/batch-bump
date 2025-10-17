const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { printSummary } = require("./printSummary");

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipPush = args.includes("--skip-push");

const cleanArgs = args.filter(
  (arg) => arg !== "--dry-run" && arg !== "--skip-push"
);
const [action, ...packages] = cleanArgs;

if (
  !["install", "i", "remove", "rm"].includes(action) ||
  packages.length === 0
) {
  console.error(`❌ Usage:
  node batch install <pkg> [more...] [--dry-run] [--skip-push]
  node batch remove <pkg> [more...] [--dry-run] [--skip-push]`);
  process.exit(1);
}

const command = ["install", "i"].includes(action) ? "install" : "uninstall";

// Load config
const config = JSON.parse(fs.readFileSync("repos.json", "utf-8"));
const basePath = config.basePath;

if (!basePath) {
  console.error('❌ Missing "basePath" in repos.json');
  process.exit(1);
}

// 🟩 Collect results here
const results = [];

config.repositories.forEach((repo) => {
  const repoPath = path.resolve(basePath, repo.name);
  const branchName = repo.branch;

  console.log(`\n📦 Repo: ${repo.name}`);
  console.log(`📂 Path: ${repoPath}`);

  if (dryRun) {
    console.log(`🔍 DRY RUN: Would checkout/create branch "${branchName}"`);
    console.log(`🔍 DRY RUN: Would run "npm ${command} ${packages.join(" ")}"`);
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
    execSync(`git commit -m "${commitPrefix}: ${packages.join(", ")}"`, {
      stdio: "inherit",
    });

    if (!skipPush) {
      execSync(`git push --set-upstream origin ${branchName}`, {
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

// 🟦 Print summary table
printSummary(results);
