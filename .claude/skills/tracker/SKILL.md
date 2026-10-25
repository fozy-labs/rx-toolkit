---
name: tracker
description: Working with a Git host (GitHub, GitLab and others) — issues, PRs/MRs, comments, labels and reviews. Use before any command that creates or changes something in the tracker.
---

<posting>
# Tracker

## Posting

- Anything posted to the tracker is visible to others and hard to take back: unless a rule below allows posting directly, post only on a clear command from the user and show the text first unless the user already approved it.
- Name the repository explicitly in every write command; do not rely on the current directory.
- Pass any multi-line body through a file, never inline: the shell needs extra escaping and the command line has a length cap.
- Before opening an issue or a PR/MR, search for an existing one and update it instead of opening a duplicate.
</posting>

<project>
## Project settings

GitHub, `fozy-labs/rx-toolkit`. Run `gh-bot`: it takes `gh` commands and flags and posts as `fozy-bot`. Without `gh-bot` on PATH, use `gh` with the same arguments.

| Action                 | Command                                                                                                                         |
|------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| Find issues / PRs      | `gh-bot issue list --repo fozy-labs/rx-toolkit --state all --search "<words>"`, same with `pr list`                             |
| Open an issue          | `gh-bot issue create --repo fozy-labs/rx-toolkit --title "<title>" --body-file <file> --type <type> --label <label>`            |
| Open a PR              | `gh-bot pr create --repo fozy-labs/rx-toolkit --base <base> --head <branch> --draft --title "<title>" --body-file <file>`      |
| Reply to review thread | `gh-bot api repos/fozy-labs/rx-toolkit/pulls/<number>/comments/<comment_id>/replies -F body=@<file>`                            |
| Mark a PR ready        | `gh-bot pr ready <number> --repo fozy-labs/rx-toolkit`                                                                          |
| Labels                 | `gh-bot label list --repo fozy-labs/rx-toolkit`; set with `gh-bot issue edit <number> --repo fozy-labs/rx-toolkit --add-label <label>`, `pr edit` alike |
| Issue type             | `Task`, `Bug`, `Feature`, `Epic`, `Initiative`, `Analytics`; set with `gh-bot issue edit <number> --repo fozy-labs/rx-toolkit --type <type>` |

The repository has no milestones or projects. Issues are written in Russian.

`main` is the default branch and gets only release merges; PRs target `develop` unless the task names another base. PRs are squash-merged: the squash commit takes the PR title (the commit subject for a one-commit PR) and lists the branch's commit messages as its body, so every commit message lands in `develop`.

CI (`.github/workflows/ci.yml`) runs `ts-check`, `format:check`, `lint` and `test` on PRs to `main` and `develop`.
</project>

<methodology>
## Methodology

Issues and PRs follow the project methodology. If none is set, ask the user, proposing an agile option.
</methodology>

<metadata>
## Labels, types and fields

On every issue and PR/MR you open, set the labels, type and fields (e.g. priority, project status, milestone) the tracker supports for it — agents tend to skip types and fields. Use only existing values; if none fits, ask the user rather than creating one.
</metadata>

<pull_requests>
## PRs/MRs

- Open a PR as a draft; mark it ready only after CI passes, Devin Review raises nothing open, and every review thread is answered.
- Answer every review thread: after a fix is pushed, reply with the commit hash directly; before declining or arguing a finding, get the user's approval.
- The title follows Conventional Commits, as in [CLAUDE.md](../../../CLAUDE.md).
- Write the body with the PR-body skill if one is installed; the repository has no PR template, so otherwise use `## Summary`, then `## Notes` when needed, then `#### Test plan` as a checklist.
- Link the issue the PR resolves with `Closes #12`.
</pull_requests>
