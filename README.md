📦 batch-install-and-push

A simple CLI tool to bulk install or remove npm packages across multiple repositories, with automatic branch creation, commits, and optional pushes.

🚀 Features

✅ Install or remove one or more packages in multiple repos

✅ Automatically creates/checks out a branch per repo

✅ Commits package.json and package-lock.json changes

✅ Pushes changes to the specified branch (unless skipped)

✅ Supports --dry-run and --skip-push

✅ Prints a summary table at the end

📁 Project Structure

````.
├── batch.js         # The main script
├── printSummary.js  # Summary table module
└── repos.json       # Repository config file```

🧾 repos.json Format
```{
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
}```


basePath: Root folder where all your local repositories live

name: Folder name of each individual repository

branch: The branch to create and push to for each repo

🖥️ Usage

From the root of this script repo:

Install packages (e.g. lodash and dayjs)
`node batch install lodash dayjs`

Or using shorthand
`node batch i lodash dayjs`

Remove packages
`node batch remove lodash dayjs`

Or using shorthand
`node batch rm lodash dayjs`

✅ Optional Flags
Flag	Description
`--dry-run`	Show what would be done, but don’t do it
`--skip-push`	Perform everything except git push
Example:
`node batch i axios --dry-run --skip-push`

📊 Summary Table

At the end of execution, a summary will be printed showing:

Repo name

Status (✅, ❌, ☑️)

Message (branch name, error, or dry-run info)

📌 Notes

Requires git and npm to be in your $PATH

Will overwrite the target branch if it already exists (git checkout -B)

You must have write access to each repo's remote
````
