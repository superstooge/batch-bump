// printSummary.js

function printSummary(results) {
  if (!Array.isArray(results) || results.length === 0) {
    console.log("\n📊 No results to summarize.");
    return;
  }

  console.log("\n📊 Summary:\n");
  console.table(results);
}

module.exports = { printSummary };
