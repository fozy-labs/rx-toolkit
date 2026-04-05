---
title: "Research — api/command.md structure analysis"
date: 2026-04-05
stage: 01-research
role: rdpi-codebase-researcher
---

# api/command.md — What should go in the API reference

Sources: usage/command.md (target design), api/resource.md (style reference), common-mistakes.md (rules).

## 1. Sections (mirror api/resource.md exactly)

- **Intro** — one sentence: что такое команда + ссылка на usage/command.md
- **Создание** — `api.createCommand(options)` minimal example (queryFn + links)
- **Опции** — full table (types, defaults, descriptions)
- **Методы** — table of instance methods (signatures, return types, descriptions)
- **См. также** — reference-style links to usage/command.md, concepts/machine.md, api/resource.md

No "Типы" section needed — resource.md doesn't have one in the final version either (it was cut). Keep parity.

## 2. Options (from usage/command.md — target design, rule #11)

| Option | Type | Default | Note |
|---|---|---|---|
| `queryFn` | `(args: TArgs) => Promise<TData>` | **required** | No `abortSignal` param (unlike resource) |
| `key` | `string` | — | Cache key prefix for devtools |
| `links` | `LinkEntry[]` | — | Cross-ref to usage/command.md#links |
| `cacheRetentionTime` | `number \| false` | `0` | Default `0` (not `60_000` like resource) |
| `onCacheEntryAdded` | `(args, lifecycle) => void` | — | Lifecycle hook |
| `onQueryStarted` | `(args, lifecycle) => void \| Promise<void>` | — | Lifecycle hook |

**DO NOT add** options from code not present in usage/command.md (rule #11).

## 3. Methods (from usage/command.md — target design)

| Method | Signature (from usage doc) | Returns | Note |
|---|---|---|---|
| `useCommand` | `useCommand(key?: string)` | `[trigger, TCommandState]` | Requires `reactHooksPlugin()`. Key is optional (unlike resource where args are required). |
| `trigger` | `trigger(args: TArgs, key?: string)` | `Promise<TData>` | Key as 2nd arg (unlike resource which takes `doForce`). |
| `createAgent` | `createAgent(opts?: { key })` | `Agent` | Accepts optional key config object. |
| `getEntry` | `getEntry(key: string)` | `CacheEntry \| null` | Takes key (string), not args (unlike resource). |
| `getEntry$` | `getEntry$(key: string)` | `CacheEntry \| null` | Reactive version; takes key (string). |

**No `refresh` method** — commands don't have SWR.
**No `link` method** — `link()` is on resource, not command.

## 4. Key differences from api/resource.md format

- **Key semantics differ**: resource uses serialized `args` as cache key; command uses explicit `key: string`. This affects param signatures of every method — resource takes `args`, command takes `key`.
- **queryFn signature**: command has no `abortSignal` parameter.
- **cacheRetentionTime default**: `0` (command) vs `60_000` (resource).
- **No `serializeArgs`**: command doesn't serialize args into cache key — it uses explicit key.
- **No `refresh`/`link` methods**: command is write-only, no SWR or link producer.
- **useCommand returns tuple** `[trigger, state]` — resource's useResource returns state object directly.
- **Intro sentence should mention "write/mutation"** vs resource's "read/cache/SWR".
