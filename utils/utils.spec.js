const fs = require("fs");
const {
  loadConfig,
  filterRepos,
  getRepoInfo,
  checkResults,
} = require("./utils");

jest.mock("fs");

describe("loadConfig", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should parse valid config and return basePath and repos", () => {
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        basePath: "/projects",
        repositories: [{ name: "repo1" }, { name: "repo2" }],
      })
    );

    const result = loadConfig();

    expect(result.basePath).toBe("/projects");
    expect(result.repos).toHaveLength(2);
  });

  it("should throw when basePath is missing", () => {
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ repositories: [{ name: "repo1" }] })
    );

    expect(() => loadConfig()).toThrow(/basePath/);
  });

  it("should throw when config file is invalid JSON", () => {
    fs.readFileSync.mockReturnValue("{ invalid }");

    expect(() => loadConfig()).toThrow(/JSON/);
  });

  it("should throw when config file cannot be read", () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() => loadConfig()).toThrow();
  });
});

describe("filterRepos", () => {
  const repos = [
    { name: "web-home", path: "web-home" },
    { name: "web-account", path: "web-account" },
    { name: "api-service", path: "api-service" },
  ];

  it("should return all repos when no filter is provided", () => {
    const result = filterRepos(repos, undefined);
    expect(result.matched).toEqual(repos);
  });

  it("should filter by repo name", () => {
    const result = filterRepos(repos, "web-home");
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].name).toBe("web-home");
  });

  it("should filter multiple repos (comma-separated)", () => {
    const result = filterRepos(repos, "web-home,api-service");
    expect(result.matched).toHaveLength(2);
  });

  it("should return unknown names that did not match", () => {
    const result = filterRepos(repos, "web-home,nonexistent");
    expect(result.matched).toHaveLength(1);
    expect(result.unknown).toContain("nonexistent");
  });

  it("should throw when no repos match the filter", () => {
    expect(() => filterRepos(repos, "nonexistent")).toThrow(/None of the names/);
  });

  it("should throw when filter string is empty/whitespace", () => {
    expect(() => filterRepos(repos, "   ")).toThrow();
  });
});

describe("getRepoInfo", () => {
  it("should derive repoName and repoPath from repo config", () => {
    const result = getRepoInfo({ name: "my-repo" }, "/base");

    expect(result.repoName).toBe("my-repo");
    expect(result.repoPath).toContain("my-repo");
  });

  it("should use path over name for repoPath when both exist", () => {
    const result = getRepoInfo({ name: "repo-name", path: "custom-path" }, "/base");

    expect(result.repoName).toBe("repo-name");
    expect(result.repoPath).toContain("custom-path");
  });
});

describe("checkResults", () => {
  it("should return exitCode 0 when all results pass", () => {
    const results = [{ ok: true }, { ok: true }];
    const { exitCode } = checkResults(results, (r) => !r.ok);
    expect(exitCode).toBe(0);
  });

  it("should return exitCode 2 when any result fails", () => {
    const results = [{ ok: true }, { ok: false }];
    const { failed, exitCode } = checkResults(results, (r) => !r.ok);
    expect(exitCode).toBe(2);
    expect(failed).toHaveLength(1);
  });
});
