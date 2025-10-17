# 📦 batch-install-and-push

A CLI tool to **bulk install or remove npm packages** across multiple repositories.
Supports automatic branch creation, commits, pushes, logging, and optional parallel execution.

---

## 🚀 Features

- ✅ Install or remove one or more packages in multiple repos
- ✅ Automatically creates/checks out a branch per repo
- ✅ Commits `package.json` and `package-lock.json` changes
- ✅ Pushes changes to the specified branch (unless skipped)
- ✅ Prints a summary table at the end
- ✅ Supports `--dry-run` and `--skip-push`
- ✅ Supports `--verbose` for terminal output
- ✅ Supports `--parallel` execution (with concurrency limit)
- ✅ Each repo has its own log file in `/logs`

---

## 📁 Project Structure

```
.
├── batch.js          # The CLI entry point
├── processRepo.js    # Repo-level operations (git, npm, logs)
├── printSummary.js   # Summary table renderer
├── repos.json        # Repository config
└── logs/             # Output logs per repo
```

---

## 🧾 `repos.json` Format

```json
{
  "basePath": "/Users/<your-username>/Projects/",
  "repositories": [
    {
      "name": "repo-one",
      "branch": "feat/dependency-update"
    },
    {
      "name": "repo-two",
      "branch": "feat/dependency-update"
    }
  ]
}
```

- `basePath`: Root folder where all your local repositories live
- `name`: Folder name of each individual repository
- `branch`: The branch to create and push to for each repo

---

## 🖥️ Usage

From the root of this script repo:

### Install packages (e.g. `lodash` and `dayjs`)

```bash
node batch install lodash dayjs
```

### Remove packages

```bash
node batch remove lodash dayjs
```

### Aliases

```bash
node batch i axios
node batch rm react-query
```

---

### ✅ Flags

| Flag          | Description                                      |
| ------------- | ------------------------------------------------ |
| `--dry-run`   | Show what would be done, but don’t do it         |
| `--skip-push` | Perform everything except `git push`             |
| `--verbose`   | Print stdout/stderr to the terminal              |
| `--parallel`  | Run tasks in parallel (default: concurrency = 5) |

### Example

```bash
node batch i axios --skip-push --parallel --verbose
```

---

## 📄 Logs

- All output from `git` and `npm` is saved per repo under `./logs/<repo>.log`
- Verbose mode will also mirror this output to the terminal

---

## 📊 Summary Table

At the end of execution, a summary will be printed showing:

- Repo name
- Status (✅, ❌, ⚠️, ☑️)
- Message (branch info or log filename)

---

## 🧠 Notes

- Uses `exec` (async) with `cwd` to safely run tasks concurrently
- Avoids `process.chdir()` which is not safe in parallel
- Automatically cleans up stale `.git/index.lock` files if needed

---

## 💬 Example Output

```
📦 ███████░░░░░░░░░░ 50% | 4/8 | repo-three::feat/update
📄 Log saved to logs/repo-three.log
✅ Committed on feat/update (log: repo-three.log)
```
