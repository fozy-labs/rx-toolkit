---
astp-source: fozy-labs/astp
astp-bundle: docs
astp-version: 1.3.0
astp-hash: ffbe7d11302177e16521be74876b9908e998cbd519278c0bc3ea4101a0744043
---
# `toMermaid()` and the round trip

`definition.toMermaid(options?)` is the reverse of the converter: a machine written as a **config** prints a
`stateDiagram-v2` in the converter's dialect. Mermaid renders the text as-is, and for machines that stay inside the
Mermaid subset the converter's `parse()` reads it back into the same config — a guarantee held by the converter's
round-trip tests.

Use it to document an existing machine, to seed a `.mmd` schema from code, or to snapshot-test a machine's shape —
the output is deterministic (document order), so the diagram can live in the repository. A machine generated **from**
a `.mmd` already carries the original text as `definition.source` (viz prefers it); `toMermaid()` is for machines
written as configs.

**Contents:** [1. Output rules](#1-output-rules) · [2. Outside the subset](#2-outside-the-subset) ·
[3. Options](#3-options) · [4. What the round trip restores](#4-what-the-round-trip-restores)

---

## 1. Output rules

| Config | Diagram |
|---|---|
| machine `id` | `%% @machine <id>` right after the header; no directive without an id |
| `context` that is a JSON value | `%% @context initial: <JSON>`; a factory or non-JSON (`undefined`, functions, `NaN`, `Date`, cycles) — no directive |
| state key | the state id: the key as-is (characters outside `[A-Za-z0-9_]` → `_`); a key repeated under another parent → the `_`-joined path (`p2_idle`) |
| `initial` | `[*] --> <initial>` in its scope |
| `on: { EVENT: { target, guard, actions } }` | `A --> B: EVENT [guard] / a, b` |
| `after: { 3000: … }` / `after: { name: … }` | `A --> B: after 3000` / `after name` |
| `onDone` | `A --> B: done` |
| `always` | no trigger: `A --> B`; with guard / actions `A --> B: [g] / a` |
| several candidates for one event | one line per candidate in config order |
| a `$final` reached only by sibling transitions (and by at least one) | `A --> [*]: EVENT` inside the scope; the state itself is not declared |
| any other final state (a `$final` with `description` / `entry` / `exit`, a `$final` initial, entered from outside the scope, unreachable) | `X --> [*]` |
| compound | `state X { … }` |
| `parallel` | regions split by `--` without own ids; a region with own transitions, `entry` / `exit`, `description` or an incoming transition stays a named block |
| `description` | `state "description" as X` (`"` → `'`, newlines → space) |
| `entry` / `exit` | `note right of X` … `end note` with lines `entry / a, b` and `exit / c` |

A transition whose source and target are siblings of one scope is written inside it; a cross-boundary transition goes
to the top level after the tree (Mermaid moves a state into the last block that mentions it — top-level mentions are
neutral). A state otherwise unmentioned in its scope is declared as a bare id line.

## 2. Outside the subset

These render fine in Mermaid but the converter does not read them back:

| Config | Diagram |
|---|---|
| history node | `state "H" as X` / `state "H*" as X` plus `X --> target: default` |
| root-level transitions, `entry` / `exit` on the root, a `parallel` root | the root is wrapped in `state <machineId> { … }` |
| targetless transition | self-loop `A --> A: EVENT / a` |
| several targets (parallel regions) | one line per target |
| inline functions, `{ type }` references | the function's `name` (`anonymous` when none) / the `type` |
| builtin guards | `and(g1, not(g2))`, `stateIn(a.x)` |
| builtin actions | `assign`, `mutate`, `raise EVENT`, `cancel`, `log` |
| wildcard events | `*`, `user.*` |
| `output`, `tags`, `meta`, `reenter`, transition `description` | not printed |

## 3. Options

| `ToMermaidOptions` | Default | |
|---|---|---|
| `direction` | `"TB"` | `"TB"` or `"LR"` |
| `includeActions` | `true` | `/ a, b` in labels, `entry` / `exit` notes |
| `includeGuards` | `true` | `[guard]` in labels |

## 4. What the round trip restores

For a machine within the subset, `parse(definition.toMermaid())` reproduces `id`, `initial`, the `states` tree and
the transitions with their guard / action / delay **names**, regions as `$0` / `$1`, `$final`, `description`. Not
restored:

- **Bodies and types.** The config has no guard / action / delay bodies or a `context` type, so `toMermaid()` cannot
  print `@guard` / `@action` / `@delay` / `@context type` directives. To feed the output to the converter or to viz
  `source` mode, write those directives in by hand — the parser rejects undeclared names.
- **Non-JSON `context`** (factory, `Date`, …) — no `@context initial` directive.
- **Everything in [§2](#2-outside-the-subset)** — rendered, not parsed.

State ids in the diagram are the config keys per the [§1](#1-output-rules) rule: a repeated or non-`[A-Za-z0-9_]` key
gets an id different from the key, and viz `machine` mode cannot highlight such a state — keep keys globally unique
when the diagram matters.
