---
name: statechart-craft
description: >
    Authoring a state machine as a Mermaid schema — the stateDiagram-v2 subset with `%% @…` directives,
    the statechart-convert CLI and the typed *.generated.ts it emits.
astp-source: fozy-labs/astp
astp-bundle: docs
astp-version: 1.3.0
astp-hash: e617d5037753154f4614a9a0cc9d409b2226531fb509fc8e125443ef5c692ee0
---

# Statechart craft

A machine is authored as one self-contained schema: a Mermaid `stateDiagram-v2` where the diagram carries the
structure and `%% @…` directive comments carry the types and the implementation bodies. The file stays **valid
Mermaid** throughout — it renders anywhere without plugins. `@fozy-labs/statechart-converter` compiles it into a typed
`createMachine` definition for `@fozy-labs/rx-toolkit`. Reference version: **0.3.0**
([fozy-labs/statechart](https://github.com/fozy-labs/statechart)).

Applies when you write or edit a `.mmd` statechart schema, a `mermaid` statechart block in Markdown, or run the
converter. The runtime executing the result (config semantics, `MachineSignal.state`, testing) is the
`fozy-labs-signals` skill, `references/statechart.md` — not this document.

## 1. The shape

```
stateDiagram-v2
    %% @machine square
    %% @context type: { result: number | null }
    %% @context initial: { result: null }
    %% @event SQUARE: { value: number }

    [*] --> idle

    %% @action square: context.result = event.value ** 2
    idle --> done: SQUARE / square
    done --> idle: RESET
```

`statechart-convert square.mmd` emits `square.generated.ts` — a plain TypeScript module, no eval:

- header `// AUTO-GENERATED from <label> — do not edit`; imports of exactly the names used;
- `Context` — the `@context type` body verbatim (`{}` without the context directives); `Events` — the union of events
  used in labels, payloads intersected in (`{ type: "SQUARE" } & { value: number }`); `StateId` — every state path,
  regions included, `$final` excluded;
- `source` — the input text verbatim (viz renders it; `config.source` carries it too);
- `definition = createMachine<Context, Events>(config, implementations)`. An `@action` body that reads `context` is
  wrapped in `mutate(…)` (an Immer draft — mutate in place); guards and delays never are. The `event` type inside a
  guard / action is narrowed to the events whose transitions reference it.

The config is run through the library's `createMachine` **before anything is written**, so an invalid machine fails
at conversion, not at runtime.

## 2. Diagram statements

Above the `stateDiagram-v2` header only blank lines and `%%` lines are allowed.

| Statement | Meaning |
|---|---|
| `[*] --> A` | initial state of the enclosing scope; **exactly one per scope** |
| `A --> [*]` | transition into the synthetic `$final` of the scope the line is written in |
| `A --> B` | eventless transition (`always`) |
| `A --> B: label` | see [§3](#3-transition-labels) |
| `A --> B: done` | `onDone` of compound/parallel `A` |
| `A --> B: after 3000` / `after name` | delayed transition; a named delay needs `@delay` |
| `state X {` … `}` | compound state; `{` ends its line, `}` sits alone |
| `--` inside a block | splits it into parallel regions `$0`, `$1`, … in source order |
| `state "Description" as X` (± `{`) | sets `description` |
| `state X <<choice>>` | choice state; only untriggered transitions may leave it |
| `X` alone on a line | declares a state in the scope |
| `note … of X: …` / `note … end note` | ignored, but `X` counts as a mention |
| `direction`, `classDef`, `class`, `:::cls` | ignored |
| `%% …` at line start | directive or comment |

State ids are `[A-Za-z_][A-Za-z0-9_]*` (not `__proto__`); ids starting with `$` are reserved for synthetic nodes.

**Anything outside that table is an error** with a line and column — deliberately including constructs Mermaid
accepts but draws differently from how they read:

| Rejected | Because |
|---|---|
| `<<fork>>`, `<<join>>`, other stereotypes | only `<<choice>>`; enter parallel regions through their own `[*]` |
| `[H]`, `[H*]` | history states are outside the schema language |
| `state X` with no body and no description | declares nothing in Mermaid |
| `X : description` | use `state "description" as X` |
| `[*] --> X: label`, `[*] --> [*]` | an initial transition carries no label |
| `stateDiagram` (v1), front matter, `%%{init}` | out of scope |
| `;` in a transition line or single-line note | Mermaid reads it as a statement separator and truncates silently |
| `%%` not at line start | not a comment there |
| `state a { [*] --> x }` on one line | blocks open at end of line, close alone |
| a block or region without `[*] -->`; `--` outside a block | every scope needs exactly one initial state |
| a state mentioned inside two different blocks | Mermaid silently keeps the last one |

## 3. Transition labels

```
label   := trigger? guard? actions?
trigger := EVENT | "after" (INT | NAME) | "done"
guard   := "[" NAME "]"
actions := "/" NAME ("," NAME)*
NAME    := [A-Za-z_][A-Za-z0-9_]*
```

Whitespace is free (`X[g]/a,b` ≡ `X [ g ] / a , b`); any character outside names, digits, `[ ] / ,` and spaces is an
error at its column. `after` and `done` are reserved — neither works as an event or delay name. **Every name** in
`[…]`, after `/` and after `after` must be declared by a directive of the matching kind.

## 4. Directives

```
directive := "%%" SP* "@" KIND (SP+ HEAD)? (":" SP* INLINE)?
continue  := "%%" SP+ LINE        -- continues the body of the nearest directive above
```

| Directive | Body | Meaning |
|---|---|---|
| `@machine <id>` | forbidden | machine id; exactly one per diagram |
| `@context type: <ts-type>` | TypeScript type | becomes `Context` |
| `@context initial: <expr>` | JS expression | initial `context` |
| `@event NAME: <ts-type>` | TypeScript type | payload: the event becomes `{ type: "NAME" } & payload` |
| `@guard NAME: <expr>` | JS expression → boolean | sees `context` and `event` |
| `@action NAME: <statements>` | JS statements | `context` is an Immer draft when the body reads it |
| `@delay NAME: <expr>` | JS expression → ms | resolves `after NAME` |

- A body = the inline text after `:` plus the `%%`-prefixed lines below. It ends at the next `%% @`, the first
  non-`%%` line, or a `%%text` line with no space after the marker (that is how you write an ordinary comment right
  under a directive). Bare `%%` inside a body is an empty line; common indentation is stripped.
- Directives may sit anywhere Mermaid tolerates a comment: above the header, at the root, inside `state X { }`.
- Errors: a repeated name within one kind, a second `@machine`, an unknown kind, an empty body, an `@event` no
  transition uses. The same name under two different kinds is fine.
- Bodies are syntax-checked by the TypeScript compiler in the exact wrapper they are emitted in; diagnostics map back
  to the body line and column. `@context type` and `@context initial` must come as a pair — one without the other
  fails at emit.

## 5. Where a state lives

The placement rule reproduces Mermaid 11.17.2 layout (held to it by differential tests): a state belongs to the
innermost block — `state X { }` or a `--` region — that **mentions** it (transition end, bare declaration, note
target, `state "d" as X`). Mentions at the root place nothing: root-only mentions make a root state; root + block
mentions put it in the block. Mentions inside two different blocks — error; so is a mention inside the state's own
block. For `A --> [*]` the scope is where the line is written.

Consequences for authoring: introduce a nested state inside its block (a transition line inside the block is enough);
cross-boundary transitions are written at the top level after the tree.

## 6. Markdown as a container

A `.md` file works as input: every ` ```mermaid ` fence declaring `%% @machine` is an independent machine; everything
else — prose, flowcharts, foreign `stateDiagram`s — is invisible to the converter. Nothing crosses a fence boundary
(directives, `@context`, guards live inside one block). Fences follow CommonMark (3+ backticks/tildes, ≤3 spaces
indent, closed by same char at same length or longer); the info string must start with `mermaid`. Two blocks with the
same `@machine` id — error; an unterminated **mermaid** fence — error. All reported lines and columns are **document**
coordinates, and the generated header names the block: `// AUTO-GENERATED from flows.md (@machine order) — do not edit`.

## 7. CLI

```sh
statechart-convert src/square.mmd              #=> src/square.generated.ts
statechart-convert src/square.mmd -o gen/sq.ts
statechart-convert docs/flows.md               #=> first machine of the document
statechart-convert docs/flows.md -m order      #=> docs/order.generated.ts
statechart-convert docs/flows.md -m order=src/order.generated.ts -m payment=src/payment.generated.ts
statechart-convert docs/flows.md --all         #=> <id>.generated.ts per machine, next to the document
```

`--format <mmd|md>` overrides the extension-based detection. `--out` only applies when the path is not already
implied (`--machine <id>` always emits `<id>.generated.ts` next to the input — use `-m <id>=<file>` to place it).
Every machine converts before anything is written. Exit codes: `0` ok, `1` read/convert/write failure or a path
collision, `2` bad arguments. Errors go to stderr as `<input>:<line>[:<column>]: <message> [(at <path>)]`.

Programmatic API: `convert(text, { fileName, ...EmitOptions })` = `parse` → `validateMachineConfig` → `emit`; the
Markdown helpers (`findStatechartBlocks`, `convertMarkdown`, …); every failure is a `StatechartParseError` with
`line`, `column?`, `path?` and `format()`.

## Rules

- ✅ One `.mmd` file (or one fenced block) = one machine, self-contained: structure, types, bodies.
- ✅ Declare every event / guard / action / delay name you use in a label — the parser rejects undeclared names.
- ✅ Keep state ids globally unique across the machine — the visualizer cannot highlight duplicated keys.
- ✅ Regenerate after every schema edit; never hand-edit `*.generated.ts`.
- ❌ Don't use Mermaid features outside [§2](#2-diagram-statements) — the converter rejects them even when Mermaid
  renders them.
- ❌ Don't put `;` in labels or rely on `%%` mid-line — Mermaid truncates silently; the converter forbids both.

## Conditional references

Load only when the situation applies — do **not** preload.

| Situation | File |
|---|---|
| Rendering a live diagram — `StatechartViz` modes, interaction, theming, eval/CSP, limitations | [references/viz.md](references/viz.md) |
| Getting a diagram out of an existing config — `toMermaid()`, its dialect, the round trip back | [references/round-trip.md](references/round-trip.md) |
