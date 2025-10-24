# 📦 batch-install-and-push

A small CLI toolkit to **bulk install or remove npm packages** across multiple local repositories.

This repo contains two scripts with clear responsibilities:

- `sync.js` — fetches remote refs and pulls a branch **only if that branch already exists locally**. It does **not** create branches. Use it to refresh remote refs/branches.
- `batch.js` — the main workflow: ensures the expected branch exists locally (creates it from `origin/<branch>` or falls back to `origin/main` / `main`), runs installs/removals, commits, and optionally pushes.

---

## 🚀 Key differences (important)

- `sync.js` will **never** create a new local branch. It only updates remote refs and pulls if the branch is already checked out locally. This is by design.
- `batch.js` is responsible for creating the local branch (if missing) before performing package changes and pushing.
- Both scripts support `--only` to limit work to a subset of repos listed in `repos.json`.

---

## ✅ Features

- Bulk install or remove packages in many repos
- `--only` to target specific repositories (comma-separated list matching `name` or `path` in `repos.json`)
- `batch.js` will create a local branch when missing:

  - prefer `origin/<branch>` → create a tracking local branch
  - else create locally from `origin/main` or local `main` as fallback

- `--dry-run` shows what would be executed without changing repositories
- `--skip-push` for disabling remote pushes when running `batch.js`
- `--verbose` prints command output to the terminal
- Optional parallel execution with a concurrency limit (defaults to sequential unless `--parallel` is provided)
- Per-repo logs are written to `./logs/` (see `processRepo.js` behavior)

---

## 📁 Project structure

```
.
├── batch.js          # The main CLI entry (creates local branches, installs, commits, pushes)
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
- `branch` — the branch `batch.js` should create/use for the change
- optional per-repo `remote` may be used if you have a non-`origin` remote configured

---

## 🖥️ Usage

Run from the folder where these scripts and `repos.json` live.

### Sync (fetch remote refs; do not create branches)

```bash
# fetch refs for a single repo and attempt pull only if branch exists locally
node sync.js --only=web-app1 --branch=main --verbose

# fetch refs for all repos listed in repos.json (default branch = main)
node sync.js --parallel --verbose
```

### Batch (create branch if needed, install/remove, commit, push)

```bash
# Install packages in all repos
node batch.js install lodash dayjs

# Remove packages in a subset of repos
node batch.js remove lodash --only=web-app1,web-app2

# Aliases
node batch.js i axios
node batch.js rm react-query
```

### Examples with useful flags

```bash
# Dry run: see what would be done
node batch.js install lodash --dry-run --only=web-app1

# Verbose with parallel execution (concurrency controlled internally)
node batch.js install lodash dayjs --parallel --verbose

# Create branch and push (skip push if you only want to commit locally)
node batch.js install lodash --verbose
node batch.js install lodash --skip-push
```

---

## 🔧 Flags summary

| Flag              | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `--only <names>`  | Comma-separated repo names/paths to process (matches `name` or `path` in `repos.json`) |
| `--dry-run`       | Show commands that would run, but do not perform changes                               |
| `--skip-push`     | Do not `git push` after commit (only for `batch.js`)                                   |
| `--verbose`       | Print `git`/`npm` output to terminal for debugging                                     |
| `--parallel`      | Run tasks concurrently (useful for many repos)                                         |
| `--branch <name>` | (sync.js) Branch to fetch/pull (default: `main`)                                       |

---

## 📝 Logs & summary

- `processRepo.js` writes per-repo logs into `./logs/<repo>.log`.
- At the end of `batch.js` execution a summary table lists each repo and its status (success / failure) and a short message.

---

## ⚠️ Important notes

- `sync.js` intentionally does not create local branches. Use it for non-invasive remote refs updates and pulls.
- `batch.js` will create local branches when needed (see behavior above). If you prefer to create branches manually, set the branch locally before running `batch.js`.
- If authentication to remotes fails (SSH keys, tokens), `git fetch`/`pull` will error — run with `--verbose` to see full stderr and fix credentials.

---
