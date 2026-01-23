const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CLI_PATH = path.resolve(__dirname, "batch.js");
const TEST_DIR = path.resolve(__dirname, "__test_fixtures__");

function runCli(args, cwd = TEST_DIR) {
  try {
    const stdout = execSync(`node "${CLI_PATH}" ${args} 2>&1`, {
      cwd,
      encoding: "utf8",
      timeout: 30000,
    });
    return { exitCode: 0, stdout };
  } catch (err) {
    return { exitCode: err.status || 1, stdout: err.stdout || "" };
  }
}

describe("batch CLI", () => {
  beforeAll(() => {
    // Create test fixtures
    fs.mkdirSync(TEST_DIR, { recursive: true });
    ["test-repo-1", "test-repo-2"].forEach((repo) => {
      fs.mkdirSync(path.resolve(TEST_DIR, repo), { recursive: true });
    });
    fs.writeFileSync(
      path.resolve(TEST_DIR, "repos.json"),
      JSON.stringify({
        basePath: TEST_DIR,
        repositories: [{ name: "test-repo-1" }, { name: "test-repo-2" }],
      })
    );
  });

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("exec command", () => {
    it("should execute command across all repos", () => {
      const result = runCli('exec "echo hello"');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("test-repo-1");
      expect(result.stdout).toContain("test-repo-2");
      expect(result.stdout).toContain("Success");
    });

    it("should filter repos with --only", () => {
      const result = runCli('exec "echo test" --only=test-repo-1 --dry-run');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("test-repo-1");
      expect(result.stdout).not.toContain("test-repo-2");
    });

    it("should exit with code 2 when commands fail", () => {
      const result = runCli('exec "exit 1"');

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain("Error");
    });
  });

  describe("error handling", () => {
    it("should error when --only matches nothing", () => {
      const result = runCli('exec "echo" --only=nonexistent');

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toContain("None of the names");
    });

    it("should error when repos.json is missing", () => {
      const result = runCli('exec "echo"', "/tmp");

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toContain("Could not read");
    });
  });
});
