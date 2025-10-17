📦 batch-install-and-push

A simple CLI tool to bulk install or remove npm packages across multiple repositories, with automatic branch creation, commits, and pushes.

🚀 Features

Install or remove one or more packages in multiple repos

Automatically creates/checks out a branch per repo

Commits package.json and package-lock.json changes

Pushes changes to the specified branch

📁 Project Structure
.
```
├── batch.js # The main script
└── repos.json # Repository config file
```

🧾 repos.json Format
```
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

basePath: The root folder where all your projects live

name: The name of each repository (a folder inside basePath)

branch: The branch to create and push to

🖥️ Usage

From the root of this script repo:

# Install packages (e.g. lodash and dayjs)

`node batch-install-and-push.js install lodash dayjs`

# Or using shorthand

`node batch-install-and-push.js i lodash dayjs`

# Remove packages (e.g. lodash and dayjs)

`node batch-install-and-push.js remove lodash dayjs`

# Or using shorthand

`node batch-install-and-push.js rm lodash dayjs`

📌 Notes

Requires git and npm to be available in your $PATH

Automatically commits and pushes changes for each repo

Will overwrite the target branch if it already exists (checkout -B)
