const fs = require("fs");
const path = require("path");
const util = require("util");
const exec = require("child_process").exec;
const execP = util.promisify(exec);

/** Remote used when neither the repo nor the config names one. */
const DEFAULT_REMOTE = "origin";

/** Base branch new branches are created from when nothing is specified. */
const DEFAULT_BASE_BRANCH = "origin/main";

/**
 * Execute a shell command with increased buffer size
 * @param {string} cmd - Command to execute
 * @param {object} execOpts - Options to pass to exec
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, error?: string, code?: number}>}
 */
async function runCmd(cmd, execOpts = {}) {
  const optsWithBuffer = { maxBuffer: 10 * 1024 * 1024, ...execOpts };
  try {
    const r = await execP(cmd, optsWithBuffer);
    return { ok: true, stdout: r.stdout || "", stderr: r.stderr || "" };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      error: err.stderr || err.message,
      code: err.code,
    };
  }
}

/**
 * Load and validate repos.json configuration
 * @param {string} configPath - Path to repos.json (defaults to "repos.json")
 * @returns {{basePath: string, repos: Array, config: object}}
 * @throws {Error} If config is invalid
 */
function loadConfig(configPath = "repos.json") {
  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (e) {
    const error = new Error(`Could not read ${configPath}: ${e.message}`);
    error.code = "CONFIG_READ_ERROR";
    throw error;
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    const error = new Error(`${configPath} is not valid JSON: ${e.message}`);
    error.code = "CONFIG_PARSE_ERROR";
    throw error;
  }

  const basePath = config.basePath;
  const repos = config.repositories || [];

  if (!basePath) {
    const error = new Error(`Missing "basePath" in ${configPath}`);
    error.code = "CONFIG_MISSING_BASEPATH";
    throw error;
  }

  return { basePath, repos, config };
}

/**
 * Resolve the base branch a new branch should be created from.
 *
 * Precedence: CLI flag → repo.baseBranch → config.baseBranch → "origin/main".
 * A value may be written with or without the remote prefix ("main" and
 * "origin/main" are equivalent); only a prefix matching the resolved remote is
 * stripped, so branch names containing slashes ("release/1.0") stay intact.
 *
 * @param {{baseBranch?: string, remote?: string}} [repo] - Repository entry from repos.json
 * @param {{baseBranch?: string, remote?: string}} [config] - Top-level repos.json config
 * @param {string} [cliBaseBranch] - Value of the --base-branch flag
 * @returns {{remote: string, branch: string, ref: string}} Remote, bare branch name and full ref
 */
function resolveBaseBranch(repo = {}, config = {}, cliBaseBranch) {
  const remote = repo.remote || config.remote || DEFAULT_REMOTE;
  const raw = String(
    cliBaseBranch || repo.baseBranch || config.baseBranch || DEFAULT_BASE_BRANCH,
  ).trim();

  const prefix = `${remote}/`;
  const branch = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;

  if (!branch) {
    const error = new Error(`Invalid baseBranch: "${raw}"`);
    error.code = "CONFIG_INVALID_BASE_BRANCH";
    throw error;
  }

  return { remote, branch, ref: `${remote}/${branch}` };
}

/**
 * Filter repositories based on --only flag
 * @param {Array} repos - Array of repository objects
 * @param {string|undefined} only - Comma-separated list of repo names to filter
 * @returns {{matched: Array, unknown: string[]}}
 */
function filterRepos(repos, only) {
  if (!only) return { matched: repos, unknown: [] };

  const onlyList = String(only)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!onlyList.length) {
    const error = new Error("--only provided but no repo names parsed");
    error.code = "FILTER_EMPTY";
    throw error;
  }

  const matched = repos.filter(
    (r) => onlyList.includes(r.name) || onlyList.includes(r.path),
  );
  const foundNames = new Set(matched.map((r) => r.name || r.path));
  const unknown = onlyList.filter((n) => !foundNames.has(n));

  if (!matched.length) {
    const error = new Error(
      `None of the names passed to --only matched repos.json: ${onlyList.join(",")}`,
    );
    error.code = "FILTER_NO_MATCH";
    throw error;
  }

  return { matched, unknown };
}

/**
 * Log execution mode (parallel vs sequential)
 * @param {boolean} parallel - Whether running in parallel
 * @param {number} concurrentCount - Number of concurrent tasks
 * @returns {string} The mode message (for testing)
 */
function getExecutionModeMessage(parallel, concurrentCount) {
  return parallel
    ? `⚡ Running in parallel mode: concurrent tasks limit is ${concurrentCount}`
    : "🐢 Running in sequential mode";
}

/**
 * Get repo name and resolved path
 * @param {{name?: string, path?: string}} repo - Repository object
 * @param {string} basePath - Base path for repositories
 * @returns {{repoName: string, repoPath: string}}
 */
function getRepoInfo(repo, basePath) {
  const repoName = repo.name || repo.path || JSON.stringify(repo);
  const repoPath = path.resolve(basePath, repo.path || repo.name || repoName);
  return { repoName, repoPath };
}

/**
 * Ensure logs directory exists and return path
 * @param {string} baseDir - Base directory (defaults to __dirname equivalent)
 * @returns {string} Path to logs directory
 */
function ensureLogsDir(baseDir = path.resolve(__dirname, "..")) {
  const logsDir = path.resolve(baseDir, "logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

/**
 * Check results for failures
 * @param {Array} results - Array of result objects
 * @param {function} failCheck - Function to determine if a result is a failure
 * @returns {{failed: Array, exitCode: number}}
 */
function checkResults(results, failCheck) {
  const failed = results.filter(failCheck);
  const exitCode = failed.length ? 2 : 0;
  return { failed, exitCode };
}

/**
 * Generate log file content for exec command
 * @param {string} command - The executed command
 * @param {string} directory - The directory where command was run
 * @param {{ok: boolean, code?: number, stdout: string, stderr: string}} result - Command result
 * @returns {string} Log file content
 */
function generateExecLogContent(command, directory, result) {
  return [
    `Command: ${command}`,
    `Directory: ${directory}`,
    `Exit code: ${result.ok ? 0 : result.code || 1}`,
    "",
    "--- stdout ---",
    result.stdout || "(empty)",
    "",
    "--- stderr ---",
    result.stderr || "(empty)",
  ].join("\n");
}

module.exports = {
  DEFAULT_REMOTE,
  DEFAULT_BASE_BRANCH,
  runCmd,
  loadConfig,
  resolveBaseBranch,
  filterRepos,
  getExecutionModeMessage,
  getRepoInfo,
  ensureLogsDir,
  checkResults,
  generateExecLogContent,
};
