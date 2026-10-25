---
name: astp
description: >-
  Install, update, check, delete, recommend and fill Claude Code skills, agents and rules with
  the astp CLI (@fozy-labs/astp). Use when the user asks to add, update, list, remove or choose
  astp bundles, skills or blocks, when `astp.lock` is involved, or when a file contains a
  <SETUP_REQUIRED> or <FILL_INSTRUCTION> block.
argument-hint: "ask [question] | fill [path] | install <bundle> | update | check | list [bundle] | delete <bundle> | <free text>"
license: MIT
---

# astp

Request: $ARGUMENTS

Written for astp 0.4. Run `astp --help` and `astp <command> --help` for what each command and flag does.

Run `astp` if it is on PATH, otherwise `npx -y @fozy-labs/astp`. Below 0.4 (`astp --version`) the commands here do not exist: tell the user to update astp.

## Route

Route by the first rule that matches:

1. The first word is `ask`, or the request is a question or asks what to install in the project: [Ask](#ask).
2. The first word is `fill`, or the request asks to fill `<SETUP_REQUIRED>` or `<FILL_INSTRUCTION>` blocks: [Fill](#fill).
3. Otherwise: [Commands](#commands).

## Commands

Without a terminal the CLI cannot prompt, so always pass `--target project` (`./.claude/`) or `--target user` (`$CLAUDE_CONFIG_DIR` if set, else `~/.claude/`), and give `install` a bundle name. Ask the user which target when it is not clear.

| Goal | Command |
|------|---------|
| See bundles (`description`, `use-when`, installed state) | `astp list --target project --json` |
| See units and blocks of a bundle (`description`, `use-when`, tags) | `astp list <bundle> --target project --json` |
| Install a whole bundle | `astp install <bundle> --target project` |
| Add units or blocks | `astp install <bundle> --skill <name> --block <name> --target project` |
| Check, then update | `astp check --target project`, then `astp update --target project` |
| Remove | `astp delete <bundle> [--skill <name>] --target project` |

- To add to an installed bundle, pass `--skill` or `--block`: a plain `install <bundle>` also brings back what the user declined.
- Commit `astp.lock` with the installed files; never edit it by hand.
- When `install` or `update` leaves `<SETUP_REQUIRED>` or `<FILL_INSTRUCTION>` blocks, run [Fill](#fill).

## Ask before `--force`

astp skips files the user changed and files it does not own. When the output reports skipped or kept files, tell the user which ones and run `--force` only with their OK, including the `--force` commands astp prints: it overwrites or deletes them.

## Ask

Read-only unless the user asks what to install for the project and approves the selection:

- **Question about bundles, units, blocks or the CLI:** run `astp list --target <target> --json` and `astp list <bundle> --target <target> --json` for the relevant bundles (plus `astp check --target <target>` or `.claude/astp.lock` when installed state matters), then answer without changing files.
- **What to install for this project** (`/astp ask` with no question, or a request to recommend): inspect the project (`package.json`, directory layout, `CLAUDE.md`, existing `.claude/`), match it against the `description` and `use-when` fields from `astp list --target project --json` and `astp list <bundle> --target project --json` for candidate bundles, propose the matching bundles, units and optional blocks with a one-line reason per item, and install only what the user approves.

## Fill

1. Find files containing `<SETUP_REQUIRED>` or `<FILL_INSTRUCTION>`: in the path passed to `/astp fill [path]`, else across the target root (`./.claude/` by default, or the user root when specified).
2. Each `<FILL_INSTRUCTION>` (from a fresh install or a conflict wrapper left by `update`) carries its own instruction: fill it with content from the real project, asking the user where the instruction says to ask or a project choice is not recorded.
3. Remove each resolved `<FILL_INSTRUCTION>…</FILL_INSTRUCTION>` and the file's `<SETUP_REQUIRED>…</SETUP_REQUIRED>` block once no `<FILL_INSTRUCTION>` remains. Keep the `<block_name>…</block_name>` tags around each block: astp tracks blocks by them.
