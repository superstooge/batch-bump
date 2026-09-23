const fs = require("fs");
const {
  loadConfig,
  resolveBaseBranch,
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

describe("resolveBaseBranch", () => {
  it("should default to origin/main when nothing is specified", () => {
    expect(resolveBaseBranch()).toEqual({
      remote: "origin",
      branch: "main",
      ref: "origin/main",
    });
  });

  it("should use config.baseBranch when no repo or CLI value exists", () => {
    expect(resolveBaseBranch({}, { baseBranch: "develop" }).ref).toBe(
      "origin/develop"
    );
  });

  it("should prefer repo.baseBranch over config.baseBranch", () => {
    const result = resolveBaseBranch(
      { baseBranch: "master" },
      { baseBranch: "develop" }
    );
    expect(result.ref).toBe("origin/master");
  });

  it("should prefer the CLI value over repo and config", () => {
    const result = resolveBaseBranch(
      { baseBranch: "master" },
      { baseBranch: "develop" },
      "release"
    );
    expect(result.ref).toBe("origin/release");
  });

  it("should accept values written with the remote prefix", () => {
    expect(resolveBaseBranch({}, {}, "origin/develop")).toEqual({
      remote: "origin",
      branch: "develop",
      ref: "origin/develop",
    });
  });

  it("should keep slashes in branch names that are not a remote prefix", () => {
    expect(resolveBaseBranch({}, {}, "release/1.0")).toEqual({
      remote: "origin",
      branch: "release/1.0",
      ref: "origin/release/1.0",
    });
  });

  it("should honour a non-origin remote from the repo", () => {
    const result = resolveBaseBranch(
      { remote: "upstream", baseBranch: "upstream/main" },
      {}
    );
    expect(result).toEqual({
      remote: "upstream",
      branch: "main",
      ref: "upstream/main",
    });
  });

  it("should trim surrounding whitespace", () => {
    expect(resolveBaseBranch({}, {}, "  develop  ").ref).toBe(
      "origin/develop"
    );
  });

  it("should throw when the value is only a remote prefix", () => {
    expect(() => resolveBaseBranch({}, {}, "origin/")).toThrow(/baseBranch/);
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
