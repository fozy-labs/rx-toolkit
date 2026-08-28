import type { LayoutData, Mermaid } from "mermaid";

import { parseTransitionLabel, type TransitionLabel } from "./transitionLabel";

/** An edge of the rendered diagram, joined with the DOM by `data-id="edge<index>"`. */
export type DiagramEdge = {
    index: number;
    /** Mermaid edge id, `edge<index>` — equals `data-id` of the path and of the label group. */
    id: string;
    /** Mermaid id of the source state (`root_start`, `working_end` for pseudo-states). */
    start: string;
    end: string;
    label: TransitionLabel;
};

export type DiagramIndex = {
    edges: DiagramEdge[];
    /** Edges by mermaid edge id. */
    byId: Map<string, DiagramEdge>;
};

let mermaidModule: Promise<Mermaid> | undefined;

/** Loads mermaid on demand; it is a peer dependency and is never bundled. */
export function loadMermaid(): Promise<Mermaid> {
    mermaidModule ??= import("mermaid").then((m) => m.default);
    return mermaidModule;
}

let renderCounter = 0;

/** Unique id for a `<svg>` produced by `mermaid.render`; mermaid prefixes every inner id with it. */
export function nextSvgId(): string {
    renderCounter += 1;
    return `scv-${renderCounter}`;
}

/** The parser data of a state diagram (`db.getData()`), see docs/svg-scheme.md. */
type StateDiagramData = Pick<LayoutData, "edges">;

const EDGE_ID_RE = /^edge(\d+)$/;

/**
 * Parses the text once more (separately from `render`) and indexes the edges.
 * State ids, edge numbering and `_start`/`_end` nodes of named scopes are
 * deterministic across parses; only unnamed regions get random ids.
 */
export async function indexDiagram(mermaid: Mermaid, text: string): Promise<DiagramIndex> {
    // `parse` registers the lazily loaded diagram detectors (as `render` and
    // `initialize` do); `getDiagramFromText` alone fails with "No diagram type
    // detected" on a fresh mermaid instance. It also reports syntax errors.
    await mermaid.parse(text);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(text);
    if (diagram.type !== "stateDiagram") {
        throw new Error(`StatechartViz: expected a stateDiagram-v2 source, got "${diagram.type}"`);
    }
    const db = diagram.db as { getData?: () => StateDiagramData };
    const data = db.getData?.();
    if (!data) {
        throw new Error("StatechartViz: mermaid state diagram db exposes no getData()");
    }
    const edges: DiagramEdge[] = [];
    for (const edge of data.edges) {
        const match = EDGE_ID_RE.exec(edge.id);
        if (!match || edge.start === undefined || edge.end === undefined) continue;
        edges.push({
            index: Number(match[1]),
            id: edge.id,
            start: edge.start,
            end: edge.end,
            label: parseTransitionLabel(edge.label ?? ""),
        });
    }
    edges.sort((a, b) => a.index - b.index);
    return { edges, byId: new Map(edges.map((e) => [e.id, e])) };
}

/**
 * Renders the diagram to SVG markup. Fails loudly for `securityLevel: "sandbox"`,
 * whose output is an `<iframe>` the viz cannot annotate.
 */
export async function renderDiagram(mermaid: Mermaid, svgId: string, text: string): Promise<string> {
    const { svg } = await mermaid.render(svgId, text);
    if (!/^\s*<svg[\s>]/i.test(svg)) {
        throw new Error('StatechartViz: mermaid did not return inline SVG (securityLevel "sandbox" is not supported)');
    }
    return svg;
}
