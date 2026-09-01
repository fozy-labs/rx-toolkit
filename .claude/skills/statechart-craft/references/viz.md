---
astp-source: fozy-labs/astp
astp-bundle: docs
astp-version: 1.3.0
astp-hash: 0a186e38ada477c8f92f086752b50ca8d0d5cb750b2025be549289533a4d61e0
---
# StatechartViz — the live visualizer

`@fozy-labs/statechart-viz` runs a statechart on top of its own Mermaid diagram: active states are highlighted from
the machine's `value`, transitions are clickable, and the event log and `context` sit beside them.

**Contents:** [1. Install](#1-install) · [2. Modes](#2-modes) · [3. Interaction](#3-interaction) ·
[4. Props](#4-props) · [5. Composition and the headless API](#5-composition-and-the-headless-api) ·
[6. Theming](#6-theming) · [7. eval and CSP](#7-eval-and-csp) · [8. Limitations](#8-limitations)

---

## 1. Install

```sh
npm install @fozy-labs/statechart-viz @fozy-labs/rx-toolkit mermaid react react-dom rxjs
```

Peers: `@fozy-labs/rx-toolkit` `>=0.12.0-rc.1`, `mermaid` `^11`, `react` / `react-dom` `^19`, `rxjs` `^7`
(type-only). `svg-pan-zoom` and the converter ship with the package; the converter (and the TypeScript compiler
behind it) is loaded through `import()` only in `source` mode — a `machine`-mode-only host never pulls it.

---

## 2. Modes

| Mode | Renders | Guard / action code |
|---|---|---|
| `machine` | `definition.source ?? definition.toMermaid()` | the compiled definition — no eval |
| `source` | the `.mmd` text, or the selected block of a Markdown document | `%% @…` bodies, compiled with `new Function` |

**machine** — `<StatechartViz machine={square$} />`. The host owns the machine: the component subscribes and never
disposes it. A different `machine` prop rebuilds the internal store (selection, log, payload reset).

**source** — `<StatechartViz source={mmdText} onMachine={(m) => …} />`. The pipeline is
`parse → validateMachineConfig → compileImplementations → createMachine → MachineSignal.state`; the component owns
the resulting machine and disposes it on text change / unmount (`onMachine` gets it, then `null`; under StrictMode
the cycle runs twice on mount). `@context initial` is passed as a factory, so every restart re-evaluates it. A
Markdown document works in place of a bare diagram: `machineId` picks the `%% @machine` block (first by default),
error lines are document coordinates.

Every stage failure lands in the notice area naming the stage and the line: `Parsing failed, line N[:col]: …`,
`Machine config error, …`, `Compiling failed, …`, `Machine creation failed: …`, `Runtime error: …` (the snapshot goes
to `status: "error"`). Programmatically `createSourceMachine` rejects with `SourceMachineError` (`stage`, `line?`,
`cause`). An unknown `machineId` produces two errors at once — the notice's pipeline message is the real one; the
diagram panel's Mermaid error is fallback noise.

---

## 3. Interaction

- **Active states** are projected from `value` onto Mermaid ids — `{ working: "green" }` lights both `working` and
  `green`. Region keys (`$0`, `$1`) address no node; a compound's `$final` maps to its `[*]` node.
- **Edges** carry one of three statuses, recomputed per snapshot: `enabled` (green, clicking sends the event),
  `blocked` (amber dashed — a guard refuses; clicking logs the refusal with the guard names and flashes the edge),
  `inert` (source not active, label not an event, or the payload is invalid — an invalid payload makes **every** edge
  inert and reports the reason next to the field).
- **Clicking a state** selects it and lists its outgoing events as buttons, ancestors included — one button per event
  name, innermost definition wins; only `on` transitions, never `after` / `always` / `onDone`. A refused button shows
  the guard in the way (`⊘ hasKey`); with several guarded candidates the badge names the first, which is not
  necessarily the one that refused.
- **Payload** merges into the event: `{ "value": 12 }` → `{ type: "SQUARE", value: 12 }`. Two editor modes behind a
  toggle: **Fields** (key/value rows, each value read as JSON, kept as string when it does not parse) and **JSON**.
  Must be a JSON object — arrays, scalars, duplicate keys are rejected under the field. Never name a key `type`.
- **Log** — last 200 attempts, newest first: `HH:MM:SS.mmm EVENT from → to`, refused `⊘ EVENT [guard] from` (UTC
  time-of-day). **Context** pretty-prints, falling back to `String(value)` when cyclic.
- Restarting from a state picked on the diagram is not offered — the library cannot start a machine at a given `value`.

---

## 4. Props

```ts
type StatechartVizProps =
    | { machine: VizMachine; title?: string }
    | { source: string; machineId?: string; title?: string;
        onMachine?: (machine: DisposableVizMachine | null) => void };

type StatechartVizRootProps = StatechartVizProps & {
    className?: string; style?: CSSProperties; unstyled?: boolean;
    store?: VizStore; children?: ReactNode;
};
```

`StatechartViz` and `StatechartViz.Root` both take `StatechartVizRootProps`. `VizMachine` is a structural subset of
`MachineStateSignal`, so `MachineSignal.state(definition)` satisfies it without a cast. `title` defaults to
`definition.id`. Whether `source` is treated as a Markdown document is a fence heuristic (a line of 3+ backticks or
tildes, ≤3 spaces of indent).

---

## 5. Composition and the headless API

`<StatechartViz />` = `<StatechartViz.Root>` + the default layout. Pass `children` to arrange the parts yourself or
add panels of your own: `Root` (provider + root element), `Header`, `Body`, `Diagram` (its `children` overlay the
diagram), `DiagramControls` (zoom in / out / fit; `useDiagramControls()` behind it), `Side`, `Notice`, `Events`,
`PayloadEditor`, `Log`, `Context`.

`useStatechartViz()` (throws outside a `Root`) returns the whole state: `machine` (`null` in `source` mode until the
pipeline resolves), `snapshot`, `title`, `notice`, `diagram` (`loading` / `ready` / `error`), `activeIds`,
`edgeStatuses`, `selectedId` + `select`, `outgoing`, `canSend(type)`, `send(type)` (logs; `false` without a machine
or with an invalid payload), `log` + `clearLog` (no built-in part calls it — for host UI), `payload`, `store`.

**The store** — selection, log and payload state as three rx-toolkit signals plus `reset()`:

```ts
type VizStore = {
    readonly selected$: StateSignal<string | null>;
    readonly log$: StateSignal<LogEntry[]>;
    readonly payload$: StateSignal<PayloadState>;
    reset(): void;
};
```

`Root` creates one per machine; `StatechartViz.createStore()` makes one the host owns, passed back as the `store`
prop — `Root` then reads and writes it but never replaces or resets it, even on a machine change; `reset()` is the
host's call, one batch. `StatechartViz.useStore()` returns the instance from inside the tree with a stable identity
(unlike the `useStatechartViz()` object, rebuilt per render), so a panel following one signal via `useSignal` wakes
for that signal alone. Writes work from outside React too: `store.selected$.set("locked")`. Nothing to dispose.

---

## 6. Theming

Every colour is a CSS custom property on `.scv` (also exported as `THEME_TOKENS`): `--scv-bg`, `--scv-panel`,
`--scv-text`, `--scv-muted`, `--scv-border`, `--scv-border-strong`, `--scv-active` (violet), `--scv-active-fill`,
`--scv-selected`, `--scv-enabled` (green), `--scv-blocked` (amber), `--scv-error` (red — paints errors only).

Each predicate owns exactly one instrument — keep the mapping when re-theming: active = the only filled node;
selected = dashed outline; sendable = `--scv-enabled` on edge, label and button alike; refused = `--scv-blocked`,
dashed; broken = `--scv-error`. The component repaints Mermaid's uniform lavender fill onto `--scv-bg` /
`--scv-border-strong` so the active state stays the only filled node; `mermaid.initialize` is never called (the
overrides are SVG-id-scoped CSS), and the graph geometry, arrowheads and label font stay Mermaid's.

Layout: `--scv-min-height` (`480px`) and `--scv-diagram-min-height` (`420px`) — set both to `0` in cramped hosts;
the side column is a fixed `320px` track. `unstyled` on `Root` drops the built-in stylesheet (`BASE_CSS` is exported
as a starting point) and leaves `scv-*` classes and `data-scv-*` attributes to the host; the diagram rules are
injected either way. The stable DOM contract for a host is the `data-scv-state` / `data-scv-edge` / `data-scv-event`
attributes.

---

## 7. eval and CSP

`source` mode executes the diagram as code: `@guard` / `@action` / `@delay` / `@context initial` bodies are compiled
with `new Function` — the only eval site in the package.

- The host needs `script-src 'unsafe-eval'`; under a strict CSP the mode does not work.
- Both modes inject `<style>` elements — `style-src` must allow inline styles or supply a nonce.
- Someone else's `.mmd` is someone else's code. For files you did not write, or under a strict CSP, use `machine`
  mode with a converter-produced definition. The library core contains no eval.

---

## 8. Limitations

- Mermaid `securityLevel: "sandbox"` is unsupported (the SVG moves into an iframe) — the component throws.
- Only `stateDiagram-v2` sources; anything else is rejected while indexing.
- Clickable events are limited to the label grammar — labels reading `after …`, `done`, nothing, or an event name
  with `-` / `.` are inert.
- Parallel regions are never highlighted: Mermaid gives their clusters no stable id, and a region's final state has
  no node.
- `machine` mode without `definition.source` relies on `toMermaid()`, which derives node ids from state keys — a key
  repeated under different parents, or containing characters outside `[A-Za-z0-9_]`, gets a different id and never
  lights up. Give states globally unique keys, or supply `source`.
- No keyboard affordance: clicks only, no accessible names.
