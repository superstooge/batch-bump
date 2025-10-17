#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { Command } = require("commander");
const { printSummary } = require("./printSummary");
const cliProgress = require("cli-progress");
const pLimit = require("p-limit").default;
const { processRepo } = require("./processRepo");

const logsDir = path.resolve(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const program = new Command();

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
  .option("--parallel", "Run tasks in parallel")
  .option("--verbose", "Enable verbose logging in the terminal")
  .action(async (packages, options) => {
    await handleRepos("install", packages, options);
  });

program
  .command("remove")
  .alias("rm")
  .description("Remove packages from all repos")
  .argument("<packages...>", "Packages to remove")
  .option("--dry-run", "Simulate the actions without executing them")
  .option("--skip-push", "Do everything except git push")
  .option("--parallel", "Run tasks in parallel")
  .option("--verbose", "Enable verbose logging in the terminal")
  .action(async (packages, options) => {
    await handleRepos("uninstall", packages, options);
  });

program.parse(process.argv);

async function handleRepos(
  command,
  packages,
  { dryRun, skipPush, parallel, verbose }
) {
  const results = [];
  const config = JSON.parse(fs.readFileSync("repos.json", "utf-8"));
  const basePath = config.basePath;

  if (!packages.length) {
    console.error("❌ You must specify at least one package.");
    process.exit(1);
  }

  if (!basePath) {
    console.error('❌ Missing "basePath" in repos.json');
    process.exit(1);
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

  if (!verbose) {
    bar.start(config.repositories.length, 0, { repo: "" });
  }

  if (verbose) {
    console.log(`🔧 Processing ${repo.name} (${branchName})`);
  }

  const limit = pLimit(concurrentCount);

  const tasks = config.repositories.map((repo) =>
    limit(() =>
      processRepo(
        repo,
        command,
        packages,
        { dryRun, skipPush, bar, verbose },
        basePath,
        results
      )
    )
  );

  try {
    await Promise.all(tasks);
  } finally {
    bar.stop();
    printSummary(results);
  }
}
