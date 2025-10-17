const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Parse CLI arguments
const [, , action, ...packages] = process.argv;

if (
  !["install", "i", "remove", "rm"].includes(action) ||
  packages.length === 0
) {
  console.error(`❌ Usage:
  node batch-install-and-push.js install <pkg> [more...]
  node batch-install-and-push.js remove <pkg> [more...]`);
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

config.repositories.forEach((repo) => {
  const repoPath = path.resolve(basePath, repo.name);
  const branchName = repo.branch;

  console.log(`\n📦 Processing: ${repo.name}`);
  console.log(`📂 Full path: ${repoPath}`);

  process.chdir(repoPath);

  try {
    if (branchName) {
      console.log(`➡️  Checking out/creating branch: ${branchName}`);
      execSync(`git checkout -B ${branchName}`, { stdio: "inherit" });
    }

    console.log(`🛠️  Running: npm ${command} ${packages.join(" ")}`);
    execSync(`npm ${command} ${packages.join(" ")}`, { stdio: "inherit" });

    execSync("git add package.json package-lock.json", { stdio: "inherit" });

    const commitPrefix = command === "install" ? "Install" : "Remove";
    execSync(
      `git commit -m "${commitPrefix}: ${packages.join(", ")}" --no-verify`,
      {
        stdio: "inherit",
      }
    );

    execSync(`git push --set-upstream origin ${branchName} --no-verify`, {
      stdio: "inherit",
    });

    console.log(`✅ Done with ${repo.name}`);
  } catch (err) {
    console.error(`❌ Error in ${repo.name}: ${err.message}`);
  }
});

console.log("\n🏁 All repositories processed.");
