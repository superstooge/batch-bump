# 📦 batch-install-and-push

A small CLI toolkit to **bulk install or remove npm packages** and **execute any shell command** across multiple local repositories.

This repo contains two scripts with clear responsibilities:

- `sync.js` — fetches remote refs and pulls a branch **only if that branch already exists locally**. It does **not** create branches. Use it to refresh remote refs/branches.
- `batch/batch.js` — the main workflow: ensures the expected branch exists locally (creates it from `origin/<branch>` or falls back to `origin/main` / `main`), runs installs/removals, commits, and optionally pushes.

---

## 🚀 Key differences (important)

- `sync.js` will **never** create a new local branch. It only updates remote refs and pulls if the branch is already checked out locally. This is by design.
- `batch/batch.js` is responsible for creating the local branch (if missing) before performing package changes and pushing.
- Both scripts support `--only` to limit work to a subset of repos listed in `repos.json`.

---

## ✅ Features

- Bulk install or remove packages in many repos
- `--only` to target specific repositories (comma-separated list matching `name` or `path` in `repos.json`)
- `batch/batch.js` will create a local branch when missing:

  - prefer `origin/<branch>` → create a tracking local branch
  - else create locally from `origin/main` or local `main` as fallback

- `--dry-run` shows what would be executed without changing repositories
- `--skip-push` for disabling remote pushes when running `batch/batch.js`
- `--verbose` prints command output to the terminal
- Optional parallel execution with a concurrency limit (defaults to sequential unless `--parallel` is provided)
- Per-repo logs are written to `./logs/` (see `processRepo.js` behavior)

---

## 📁 Project structure

```
.
├── batch/
│   ├── batch.js      # The main CLI entry (creates local branches, installs, commits, pushes)
│   └── batch.spec.js # Integration tests
├── utils/
│   ├── utils.js      # Shared utility functions
│   └── utils.spec.js # Unit tests
├── sync.js           # Lightweight fetch/pull tool (does NOT create branches)
├── processRepo.js    # Repo-level operations (git, npm, logging, push)
├── printSummary.js   # Summary table renderer
├── repos.json        # Repository config
└── logs/             # Output logs per repo
```

---

## 🧾 `repos.json` format

```json
{
  "basePath": "/Users/<you>/Projects/",
  "repositories": [
    { "name": "web-app1", "branch": "chore/test" },
    { "name": "web-app2", "branch": "fix/bug" }
  ]
}
```

- `basePath` — root folder where your local repos live
- `name` — folder name or identifier for the repo (used by `--only`)
- `branch` — the branch `batch/batch.js` should create/use for the change
- optional per-repo `remote` may be used if you have a non-`origin` remote configured

---

## 🖥️ Usage

Run from the folder where these scripts and `repos.json` live.

**Quick start:** Use the npm scripts for convenience:
- `pnpm batch` (or `npm run batch`) for batch operations
- `pnpm sync` (or `npm run sync`) for sync operations

Alternatively, run directly:
- `node batch/batch.js` for batch operations
- `node sync.js` for sync operations

### Sync (fetch remote refs; do not create branches)

```bash
# fetch refs for a single repo and attempt pull only if branch exists locally
pnpm sync --only=web-app1 --branch=main --verbose

# fetch refs for all repos listed in repos.json (default branch = main)
pnpm sync --parallel --verbose
```

### Batch (create branch if needed, install/remove, commit, push)

```bash
# Install packages in all repos
pnpm batch install lodash dayjs

# Remove packages in a subset of repos
pnpm batch remove lodash --only=web-app1,web-app2

# Aliases
pnpm batch i axios
pnpm batch rm react-query
```

### Exec (run any shell command in all repos)

```bash
# Run any shell command across all repos
pnpm batch exec "git status"

# Create GitHub PRs across repos (great after batch package changes)
pnpm batch exec "gh pr create --title 'feat: update dependencies' --base main"

# Run commands in specific repos only
pnpm batch exec "npm outdated" --only=web-app1,web-app2

# Check for uncommitted changes
pnpm batch exec "git diff --stat" --parallel --verbose
```

### Examples with useful flags

```bash
# Dry run: see what would be done
pnpm batch install lodash --dry-run --only=web-app1

# Verbose with parallel execution (concurrency controlled internally)
pnpm batch install lodash dayjs --parallel --verbose

# Create branch and push (skip push if you only want to commit locally)
pnpm batch install lodash --verbose
pnpm batch install lodash --skip-push

# Execute shell commands with dry run
pnpm batch exec "gh pr create --title 'fix: analytics'" --dry-run
```

---

## 📜 Available Scripts

| Script | Command | Description |
| ------ | ------- | ----------- |
| `pnpm batch` | `node batch/batch.js` | Run batch operations (install/remove/exec) |
| `pnpm sync` | `node sync.js` | Sync repos (fetch/pull only) |
| `pnpm test` | `jest` | Run all tests |
| `pnpm test:watch` | `jest --watch` | Run tests in watch mode |
| `pnpm test:coverage` | `jest --coverage` | Run tests with coverage |

---

## 🔧 Flags summary

| Flag              | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `--only <names>`  | Comma-separated repo names/paths to process (matches `name` or `path` in `repos.json`) |
| `--dry-run`       | Show commands that would run, but do not perform changes                               |
| `--skip-push`     | Do not `git push` after commit (only for `batch/batch.js install/remove`)              |
| `--verbose`       | Print command output to terminal for debugging                                         |
| `--parallel`      | Run tasks concurrently (useful for many repos)                                         |
| `--branch <name>` | (sync.js) Branch to fetch/pull (default: `main`)                                       |

## 🖥️ Commands summary

| Command                  | Alias | Description                                |
| ------------------------ | ----- | ------------------------------------------ |
| `install <packages...>`  | `i`   | Install npm packages in all repos          |
| `remove <packages...>`   | `rm`  | Remove npm packages from all repos         |
| `exec <command...>`      | `run` | Execute any shell command in all repos     |

---

## 📝 Logs & summary

- `processRepo.js` writes per-repo logs into `./logs/<repo>.log`.
- At the end of `batch.js` execution a summary table lists each repo and its status (success / failure) and a short message.

---

## ⚠️ Important notes

- `sync.js` intentionally does not create local branches. Use it for non-invasive remote refs updates and pulls.
- `batch/batch.js` will create local branches when needed (see behavior above). If you prefer to create branches manually, set the branch locally before running `batch/batch.js`.
- If authentication to remotes fails (SSH keys, tokens), `git fetch`/`pull` will error — run with `--verbose` to see full stderr and fix credentials.

---
