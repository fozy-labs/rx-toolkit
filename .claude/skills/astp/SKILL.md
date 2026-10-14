---
name: astp
description: >-
  Install, update, check and delete Claude Code skills, agents and rules with the astp CLI
  (@fozy-labs/astp). Use when the user asks to add, update, list or remove astp bundles or
  skills, when `astp.lock` is involved, or when a file contains a <SETUP_REQUIRED> block.
license: MIT
---

# astp

Written for astp 0.4. Run `astp --help` and `astp <command> --help` for what each command and flag does.

Run `astp` if it is on PATH, otherwise `npx -y @fozy-labs/astp`. Below 0.4 (`astp --version`) the commands here do not exist: tell the user to update astp.

## Commands

Without a terminal the CLI cannot prompt, so always pass `--target project` (`./.claude/`) or `--target user` (`$CLAUDE_CONFIG_DIR` if set, else `~/.claude/`), and give `install` a bundle name. Ask the user which target when it is not clear.

| Goal | Command |
|------|---------|
| See bundles | `astp list --target project --json` |
| See units and blocks of a bundle | `astp list <bundle> --target project --json` |
| Install a whole bundle | `astp install <bundle> --target project` |
| Add units or blocks | `astp install <bundle> --skill <name> --block <name> --target project` |
| Check, then update | `astp check --target project`, then `astp update --target project` |
| Remove | `astp delete <bundle> [--skill <name>] --target project` |

- To add to an installed bundle, pass `--skill` or `--block`: a plain `install <bundle>` also brings back what the user declined.
- Commit `astp.lock` with the installed files; never edit it by hand.

## Ask before `--force`

astp skips files the user changed and files it does not own. When the output reports skipped or kept files, tell the user which ones and run `--force` only with their OK, including the `--force` commands astp prints: it overwrites or deletes them.

## Filling blocks

A `<SETUP_REQUIRED>` block after the frontmatter, or a `<FILL_INSTRUCTION>` left by `update`, carries its own instruction: follow it with content from the real project. Keep the `<block_name>…</block_name>` tags around each block: astp tracks blocks by them.
