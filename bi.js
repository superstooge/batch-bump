const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Get packages from CLI args
const [, , ...cliPackages] = process.argv;

if (cliPackages.length === 0) {
  console.error("❌ You must specify at least one package, e.g.:");
  console.error("   node batch-install-and-push.js lodash axios");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync("repos.json", "utf-8"));

config.repositories.forEach((repo) => {
  const repoPath = path.resolve(repo.path);
  const branchName = repo.branch;

  console.log(`\n📦 Processing repo: ${repoPath}`);

  process.chdir(repoPath);

  try {
    // Checkout or create branch
    if (branchName) {
      console.log(`➡️  Creating/checking out branch: ${branchName}`);
      execSync(`git checkout -B ${branchName}`, { stdio: "inherit" });
    }

    // Install packages
    console.log(`📥 Installing: ${cliPackages.join(" ")}`);
    execSync(`npm install ${cliPackages.join(" ")}`, { stdio: "inherit" });

    // Commit and push changes
    execSync(`git add package.json package-lock.json`, { stdio: "inherit" });
    execSync(`git commit -m "Install: ${cliPackages.join(", ")}"`, {
      stdio: "inherit",
    });
    execSync(`git push --set-upstream origin ${branchName}`, {
      stdio: "inherit",
    });

    console.log(`✅ Done with ${repoPath}`);
  } catch (err) {
    console.error(`❌ Error in ${repoPath}: ${err.message}`);
  }
});

console.log("\n🏁 All done.");
