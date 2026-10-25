# Guard

`/git guard` makes destructive git commands need the user's approval from the agent runtime itself, whatever the agent remembers.

## Procedure

1. Ask which form to install; recommend ask rules:

   | Form              | What happens on a matching command                                   | Gap                                                                     |
   |-------------------|----------------------------------------------------------------------|-------------------------------------------------------------------------|
   | ask rules         | the runtime shows its usual approval prompt                          | rules match command text: `git -C <dir> push --force` slips past        |
   | ask rules + hook  | the same prompt; the hook also parses the command and catches `-C`, `-c`, flag order | the hook script lives on disk and needs `node`                          |
   | deny rules        | the command is refused, no prompt                                    | `/git` cannot run it either, even on the user's word                    |

2. Write to the level the `/git` skill is installed at — the project when the skill sits under the project's `.claude/`, the user otherwise:

   | Runtime     | Project                 | User                                                                   |
   |-------------|-------------------------|------------------------------------------------------------------------|
   | Claude Code | `.claude/settings.json` | `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`     |
   | Devin CLI   | `.devin/config.json`    | `%APPDATA%\devin\config.json` (Windows), else `~/.config/devin/config.json` |

   Write the Devin file only when the project has `.devin/` or the session runs in Devin CLI.
3. Show the user the exact change and get approval. Merge into existing arrays, skip entries already present, keep everything else in the file. An existing allow rule that is equally or more specific wins over a Devin ask rule — report such rules.
4. Check: run `git clean -n` — it lists, deletes nothing. A prompt (or a refusal, for deny rules) means the guard works.

## Rules

Claude Code, in `permissions.ask` (or `permissions.deny`). `*` matches any text; a rule matches the command text, including each part of `&&`, `;` and `|` chains. Add each rule twice, as `Bash(…)` and as `PowerShell(…)`:

```text
git push *-f*
git push *+*
git push *--no-verify*
git push *--delete*
git push *-d *
git reset *--hard*
git clean *
git branch *-D*
git branch *--force*
git checkout *-- *
git checkout .
git checkout -f*
git checkout *--force*
git restore *
git stash drop *
git stash clear *
git commit *--amend*
git commit *--no-verify*
git worktree remove *--force*
```

`git push *-f*` also catches `--force` and `--force-with-lease` — and, with a needless prompt, `--follow-tags` and branch names containing `-f`.

Devin CLI, in `permissions.ask` (or `permissions.deny`). `Exec(…)` matches a command prefix, so flag order matters:

```text
Exec(git push --force)
Exec(git push -f)
Exec(git push --delete)
Exec(git push -d)
Exec(git reset --hard)
Exec(git clean)
Exec(git branch -D)
Exec(git checkout --)
Exec(git checkout .)
Exec(git restore)
Exec(git stash drop)
Exec(git stash clear)
Exec(git commit --amend)
```

## Hook

Claude Code only. Save as `hooks/git-guard.mjs` next to the settings file, and register it under `hooks` in the same file with the script's absolute path:

```json
{
    "hooks": {
        "PreToolUse": [
            { "matcher": "Bash|PowerShell", "hooks": [{ "type": "command", "command": "node \"<absolute path>/git-guard.mjs\"" }] }
        ]
    }
}
```

```js
// Asks for approval before destructive git commands, however they are spelled.
import { readFileSync } from "node:fs";

const command = JSON.parse(readFileSync(0, "utf8")).tool_input?.command ?? "";

const has = (args, short, ...long) =>
    args.some(
        (a) =>
            long.some((l) => a === l || a.startsWith(`${l}=`)) ||
            (short !== null && /^-[a-zA-Z]+$/.test(a) && a.includes(short)),
    );

const risky = {
    push: (a) => has(a, "f", "--force", "--force-with-lease", "--force-if-includes", "--no-verify", "--delete", "--mirror") ||
        has(a, "d") || a.some((x) => x.startsWith("+")),
    reset: (a) => has(a, null, "--hard", "--merge", "--keep"),
    clean: () => true,
    branch: (a) => has(a, "D", "--force"),
    checkout: (a) => a.includes("--") || a.includes(".") || has(a, "f", "--force"),
    switch: (a) => has(a, "f", "--force", "--discard-changes"),
    restore: (a) => !has(a, "S", "--staged") || has(a, "W", "--worktree"),
    stash: (a) => a[0] === "drop" || a[0] === "clear",
    commit: (a) => has(a, "n", "--amend", "--no-verify"),
    worktree: (a) => a[0] === "remove" && has(a, "f", "--force"),
};

const withValue = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);

const hit = command.split(/&&|\|\||\$\(|[;|\n`()]/).some((segment) => {
    const words = [...segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    return words.some((word, i) => {
        if (!/(^|[\\/])git(\.exe)?$/i.test(word)) return false;
        let j = i + 1;
        while (j < words.length && words[j].startsWith("-")) j += withValue.has(words[j]) ? 2 : 1;
        return risky[words[j]]?.(words.slice(j + 1)) ?? false;
    });
});

if (hit) {
    console.log(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: "Destructive git command: approval required by /git guard.",
        },
    }));
}
```

Check the hook the same way: `git -C . clean -n` must prompt.
