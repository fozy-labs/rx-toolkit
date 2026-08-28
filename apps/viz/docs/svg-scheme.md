# Mermaid SVG scheme (browser spike)

Date: 2026-08-28. Mermaid `11.17.2` (pinned devDependency of `apps/viz`), Chromium via Playwright,
`securityLevel: "strict"` (mermaid default). Reproduce: `npm run dev`, open `/spike/` (`spike/index.html`),
inspect `window.__spike`; `?securityLevel=loose|sandbox` switches the level.

Diagrams rendered: the proposal's `trafficLight` (compound, `[*]` inside a compound, `%%` directives) and
`square` (two candidates for one event), plus a `parallel` fixture (two regions via `--`, region finals,
`state "desc" as id`, `state c1 <<choice>>`).

## Contents

- [Render output](#render-output)
- [State nodes](#state-nodes)
- [Composite blocks and regions](#composite-blocks-and-regions)
- [Start and end pseudo-states](#start-and-end-pseudo-states)
- [Edges and edge labels](#edges-and-edge-labels)
- [Diagram data from the parser](#diagram-data-from-the-parser)
- [Security levels](#security-levels)
- [Highlighting strategy](#highlighting-strategy)
- [Click handling](#click-handling)
- [Decision](#decision)

## Render output

`mermaid.render(svgId, text)` resolves to `{ svg, bindFunctions }`; `svg` is the markup of one
`<svg id="<svgId>" class="statediagram" width="100%" viewBox="…" role="graphics-document document">`.
Inside: `style` (every rule scoped with `#<svgId> …`), one `g` → `g.root` → `g.clusters`, `g.edgePaths`,
`g.edgeLabels`, `g.nodes`, two `defs` (markers, drop-shadow filters). Every `id` in the output is prefixed
with `<svgId>-`; the arrow marker is `<svgId>_stateDiagram-barbEnd`.

`%% @…` directive lines produce no nodes: the node list equals the set of states in the diagram.

## State nodes

```html
<g class="node  statediagram-state" id="<svgId>-state-<mermaidId>-<n>" data-look="classic" transform="…">
    <rect class="basic label-container" …/>
    <g class="label">…foreignObject → div → span.nodeLabel…</g>
</g>
```

- Lives under `g.nodes`. No `data-id` attribute on state nodes.
- `<n>` is an internal counter (`state-off-4`, `state-working-5`, `state-green-8`): not stable across
  diagrams, must not be relied on. The mermaid id is recovered with `^<svgId>-state-(.+)-\d+$` (greedy
  group — mermaid ids of the subset never contain `-`, region ids do, digits may end an id:
  `state-s1-3` → `s1`).
- `state "All regions finished" as finished` → id `finished`, the label text is the description.
- `state c1 <<choice>>` → the same `g.node.statediagram-state` scheme, the body is a diamond `path` inside
  a `g` (no `rect`).

## Composite blocks and regions

```html
<g class="statediagram-state statediagram-cluster" id="<svgId>-state-working-5" data-id="working" data-look="classic">
    <g><rect class="outer" …/></g>
    <g class="cluster-label">…foreignObject…</g>
    <rect class="inner" …/>
</g>
```

- Lives under `g.clusters` (flat: nested clusters are siblings, not DOM descendants). Not matched by
  `g.cluster` — the class is `statediagram-cluster`.
- Carries `data-id="<mermaidId>"` — a composite is identified by `data-id`, no regex needed.
- Parallel regions (`--`): `g.statediagram-state.statediagram-cluster.statediagram-cluster-alt` with a
  single `rect.divider`, **no** `data-id`, id `<svgId>-state-<regionId>-<n>` where the first region's id is
  `divider-id-1` and the following ones are random (`id-n2331etg9vo-2`, different on every parse). Regions
  cannot be addressed by a stable id — consistent with the config contract (`$0`, `$1` are not mermaid ids).

## Start and end pseudo-states

`[*]` renders as ordinary nodes under `g.nodes`, class `node default`:

| Source | Node id (mermaid) | DOM id | Body |
|---|---|---|---|
| `[*] --> off` at root | `root_start` | `<svgId>-state-root_start-0` | `circle.state-start` |
| `[*] --> green` inside `state working {}` | `working_start` | `<svgId>-state-working_start-5` | `circle.state-start` |
| `red --> [*]` inside `state working {}` | `working_end` | `<svgId>-state-working_end-9` | `g.outer-path` (two paths) |
| `[*]` inside a region | `<regionId>_start` / `<regionId>_end` | random for regions ≥ 2 | same |

So the config's `$final` of a compound `X` maps to the mermaid node `X_end`, the root `$final` to
`root_end`; region finals have no stable node (see above).

## Edges and edge labels

```html
<g class="edgePaths">
    <path d="…" id="<svgId>-edge1" class="edge-thickness-normal edge-pattern-solid transition"
          data-edge="true" data-et="edge" data-id="edge1" data-look="classic" marker-end="url(#<svgId>_stateDiagram-barbEnd)"/>
</g>
<g class="edgeLabels">
    <g class="edgeLabel" transform="…">
        <g class="label" data-id="edge1"><foreignObject><div><span class="edgeLabel"><p>POWER_ON [hasPower] / logStart</p></span></div></foreignObject></g>
    </g>
</g>
```

- Path: `path.transition[data-id="edge<i>"]`, id `<svgId>-edge<i>`. DOM order is not source order
  (`edge0, edge4, edge1, …`); `data-id` is the key.
- Label: `g.edgeLabel > g.label[data-id="edge<i>"]` — the same key as the path. Unlabelled edges
  (`[*] --> off`) still have a label group with a `0×0` foreignObject.
- Neither the path nor the label carries source/target ids; they come from the parser data (next section).
- Hit-testing the middle of a path returns the label's `<p>` (labels sit on the path midpoint): a click
  there still resolves to the edge through `closest("g.edgeLabel")`.

## Diagram data from the parser

`mermaid.mermaidAPI.getDiagramFromText(text)` → `diagram.db.getData()` returns `{ nodes, edges }`:

- `nodes[i]`: `{ id, label, parentId?, isGroup, shape: "rect" | "roundedWithTitle" | "divider" | "stateStart" | "stateEnd" | "choice", domId }`;
  `domId` (`state-off-4`) equals the DOM id without the `<svgId>-` prefix for every non-random id.
- `edges[i]`: `{ id: "edge<i>", start, end, label }` — `start`/`end` are mermaid ids (including
  `root_start`, `working_end`), `label` is the raw label text. `edges[i].id` equals the DOM `data-id`, so
  the DOM edge ↔ parser edge join is by `data-id`, independent of DOM order.
- Random region ids differ between the `getDiagramFromText` call and the `render` call (separate parses).
  Everything else (state ids, edge numbering, `_start`/`_end` of named scopes) is deterministic for the
  same text.

## Security levels

| Level | Result |
|---|---|
| `strict` (default) | ids, `data-id`, classes exactly as documented above; labels via `foreignObject` (htmlLabels). |
| `loose` | not needed: `strict` is sufficient for everything the viz does. |
| `sandbox` | `render()` returns `<iframe src="data:text/html;base64,…">` — the SVG lives inside an iframe, no DOM access, no highlighting or clicks. Unsupported. |

## Highlighting strategy

Both strategies were verified:

1. **Toggle class in place** (chosen). `classList.add("active")` on `g.node` / `g.statediagram-cluster`
   changes the rendered stroke immediately (computed `stroke` went from `rgb(147,112,219)` to the
   override). Mermaid's own rules are `#<svgId> .node rect {…}` / `#<svgId> .statediagram-cluster rect {…}`
   (specificity 1,1,1), so the override must either be scoped with the svg id
   (`#<svgId> .node.active > rect`, 1,3,1) or use `!important`. The cluster's visible frame is
   `rect.outer` (nested in a `g`), the node's is the direct `rect.label-container`.
2. **Re-render with `classDef active …` + `class a,b active`** (fallback). Works: the class lands on
   `g.node` (`node active statediagram-state`) and on the cluster
   (`active statediagram-state statediagram-cluster`). Costs a full mermaid re-layout per snapshot and
   destroys the pan-zoom state.

## Click handling

Event delegation on the `<svg>` with `closest()` resolves every target that matters:

| Clicked element | `closest(...)` | Key |
|---|---|---|
| `path.transition` | `path.transition[data-id]` | `data-id` → edge index |
| label `span`/`p` | `g.edgeLabel` → `g.label[data-id]` | `data-id` → edge index |
| `rect` / label of a state | `g.node` | id regex → mermaid id |
| `rect.inner` / `cluster-label` of a composite | `g.statediagram-cluster` | `data-id` → mermaid id |

## Decision

- Render once with `mermaid.render(svgId, text)`, index the SVG once: `data-scv-state="<mermaidId>"` on
  `g.node` (regex of [State nodes](#state-nodes)) and `g.statediagram-cluster` (`data-id` of
  [Composite blocks and regions](#composite-blocks-and-regions)); `data-scv-edge="<i>"` on
  `path.transition` and `g.edgeLabel`, joined with the parser edges by `data-id`
  ([Diagram data from the parser](#diagram-data-from-the-parser)).
- Per snapshot toggle a class on `[data-scv-state]` elements (strategy 1 of
  [Highlighting strategy](#highlighting-strategy)); the config → node mapping for `$final` is the table in
  [Start and end pseudo-states](#start-and-end-pseudo-states), region keys and region finals have no node.
- Override styles with svg-id-scoped rules generated per render; `svg-pan-zoom` on the same `<svg>`.
- The re-render fallback stays a documented option only.
