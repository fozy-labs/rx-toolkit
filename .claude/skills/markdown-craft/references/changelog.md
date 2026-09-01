---
astp-source: fozy-labs/astp
astp-bundle: docs
astp-version: 1.3.0
astp-hash: b5a46734499c55731b6859f94a23626ebad2c0a1f63c4979dd3794d58ea991a2
---
# Changelog

Load before writing or editing any entry of a `CHANGELOG.md`. The file format is
[Keep a Changelog 2.0.0](https://keepachangelog.com/en/2.0.0/), which puts the division of
labour as *machines can draft, humans curate* — this reference is the drafting half, and
everything the format leaves open.

The reader is a consumer deciding whether to upgrade and what breaks when they do. They never
saw the diff, cannot see the internals, and know only the public API.

## Contents

- [1. What earns an entry](#1-what-earns-an-entry)
- [2. Entry shape](#2-entry-shape)
- [3. A feature is one entry and a link](#3-a-feature-is-one-entry-and-a-link)
- [4. Sections](#4-sections)
- [5. Unreleased and the release ritual](#5-unreleased-and-the-release-ritual)
- [6. Examples](#6-examples)

## 1. What earns an entry

- **The unit is one consumer-visible change** — not a commit, not a PR, not a file. Five
  commits building one feature are one entry; one commit fixing three modules is three.
- **No visible change, no entry.** Internal refactors, private renames, tests, build and CI
  plumbing leave no trace, however large the diff. A performance change qualifies only when the
  consumer can measure it — and then the entry carries the number.
- **A documentation correction is at most one line per module**, stating what was wrong, never
  an enumeration of the fixed pages.
- **Name the exported symbol as the consumer types it** — `unstable_ProxySignal`, not the
  internal class, not the informal module name.

## 2. Entry shape

`Fixed` follows one formula: **symptom the consumer hit → conditions it happened under →
`Now <new behaviour>`**. The first clause must let a reader recognise their own bug without
knowing the codebase; the last one tells them what the upgrade buys. A symptom without the
`Now` clause reads as a known open bug.

`Added` / `Changed` name the symbol, give one clause of what the consumer gets, and link the
docs page that carries the rest.

- **The mechanism never ships.** Which comparison was wrong, which internal structure replaced
  which, why a guard did not hold — the reader cannot act on any of it. Its home is the PR.
  This is the single most common thing to cut.
- **Cap entries at ~300 characters in `Fixed`, ~350 elsewhere.** Over the cap the entry is
  carrying documentation: cut it back to the symptom and link.
- **A list of names is a docs table.** Give one or two examples and link the table.

## 3. A feature is one entry and a link

The feature's home is its docs page ([One home per fact](../SKILL.md#1-one-home-per-fact)); a
bullet per API in the changelog is a copy of that page, and copies drift. One entry per feature:
the name, what it is for, the link. Sub-APIs, options, dialects, demo pages and companion
packages of that feature get no entries of their own.

## 4. Sections

Six types, and the set never grows: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
`Security`. An empty section is not written. Classify by what the change costs the reader:

| The consumer must               | Section              |
|---------------------------------|----------------------|
| nothing, may adopt it           | `Added`              |
| adapt working code              | `Changed`, `Removed` |
| plan work before the next major | `Deprecated`         |
| upgrade and nothing else        | `Fixed`              |

- **`Changed` or `Fixed` — was the old behaviour a bug?** If it was, `Fixed`; if it was
  intentional and is now altered, `Changed`.
- **A vulnerability goes to `Security`** whichever of the two it would otherwise fit — different
  urgency, different audience. With a CVE the entry leads with it:
  `- CVE-2024-12345: out-of-bounds read when parsing malformed input.`
- **A breaking change stays in its type and takes a `**Breaking:**` prefix.** Upgrade steps are
  linked — the migration guide goes directly under the version heading, above the sections —
  never spelled out inline.
- **`Deprecated` names the replacement and the exact equivalent call**, plus the difference
  when the equivalence is not exact.
- **`Removed` says why when the thing never worked**, so nobody hunts for a migration path.

## 5. Unreleased and the release ritual

- **New entries go under `## [Unreleased]`.** Never invent a version number or a release date —
  cutting a release is the maintainer's call.
- **Closing a release is one edit**: insert `## [X.Y.Z] - YYYY-MM-DD` above the accumulated
  entries so `## [Unreleased]` is left empty; add the `[X.Y.Z]` compare link to the reference-link
  block at the end of the file; retarget the `[Unreleased]` link to compare from the new tag. A
  version heading without its link renders as literal brackets.
- **Every version compares to its predecessor**, newest first; the oldest one links its release
  tag instead. A pulled release keeps its heading and gains a marker:
  `## [0.0.5] - 2014-12-13 [YANKED]`.
- **Released sections are frozen.** Later work adds to `Unreleased`; a released entry is edited
  only to fix a typo.
- **A release summary is one or two sentences above the typed sections**, written only when the
  release has a theme a list of entries does not convey. Default to omitting it.
- **A new file opens with `# Changelog`**, the standard "All notable changes…" preamble, and
  links to the Keep a Changelog version followed (pinned — `/en/2.0.0/`, never `latest`) and to
  the versioning scheme. An existing file's header is left as it is.

## 6. Examples

Every pair below is an agent's version and the maintainer's rewrite of it.

**Per-API bullets → one entry** ([3](#3-a-feature-is-one-entry-and-a-link)). Four more bullets
in the same shape were cut together with these two:

```markdown
- **Statechart**: builtin `mutate()` — updates `context` through an Immer draft;
  `config.source` / `definition.source` — the source text of the `.mmd` schema; the functions of
  the implementation table can narrow `event` to the transitions that reference them.
- **Statechart: schema authoring** — separate packages, not part of `@fozy-labs/rx-toolkit`: the
  converter `@fozy-labs/statechart-converter` (`.mmd` — mermaid `stateDiagram-v2` with `%% @…`
  directives — into a typed `*.generated.ts` with `createMachine`; …) and the viz …
```

```markdown
- **Statechart** — state machines on an own runtime over signals, with no external
  dependencies. See [docs/statechart](./statechart/README.md).
```

**Inline documentation → link** ([2](#2-entry-shape)). The original ran to 800 characters of
subscription semantics, GC behaviour and the internal structure it replaced:

```markdown
- **`unstable_KeyedSignal` (experimental)** — a reactive keyed collection with per-key
  subscription. See [RxSignals](./signals/README.md#unstable_keyedsignal).
```

**Mechanism → symptom** ([2](#2-entry-shape)):

```markdown
- Relative imports in `dist/` now carry the `.js` extension (`tsc-alias --resolve-full-paths`):
  the package imports straight from Node ESM and types under `moduleResolution: nodenext`.
  Previously `import("@fozy-labs/rx-toolkit")` in Node failed with `ERR_UNSUPPORTED_DIR_IMPORT`
  and only worked through bundlers.
- A late cleanup of an old signal erased the record of a new one with the same key: on garbage
  collection `State` sends `$COMPLETED` to devtools through `FinalizationRegistry`, and that
  deleted whatever was under the key at that moment …
```

```markdown
- Fixed relative imports in `dist` that caused an `ERR_UNSUPPORTED_DIR_IMPORT` error in Node.js.
- A late cleanup of an old signal erased the record of a new one with the same key.
```

**Diagnosis cut, formula kept** ([2](#2-entry-shape)) — symptom, conditions and `Now` all
survive, only the internal cause goes:

```markdown
- `LocalState.clear()` did not remove falsy values (`0` / `""` / `false` / `null`) from storage:
  a truthiness check instead of a key-presence check left the record, and the value "came back"
  after a reload. Now the record is removed regardless of its value.
```

```markdown
- `LocalState.clear()` did not remove falsy values (`0` / `""` / `false` / `null`) from storage —
  the record stayed and the value "came back" after a reload. Now the record is removed
  regardless of its value.
```

**Name list → table link** ([2](#2-entry-shape)):

```markdown
- Resource and command state transitions are labelled with the action name in devtools:
  `UPDATE: success`, `UPDATE: error`, `UPDATE: refresh`, `UPDATE: rebase`,
  `UPDATE: refresh-error`, `UPDATE: retry`, `UPDATE: patch`, `UPDATE: patch-settled`,
  `UPDATE: sync`. Previously all updates …
```

```markdown
- Resource and command state transitions are labelled with the action name in devtools:
  `UPDATE: success`, `UPDATE: error` and etc. The table of names is in
  [docs/devtools](./devtools/README.md#action-names-of-resources-and-commands).
```
