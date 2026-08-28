import type { DiagramIndex } from "./mermaidGraph";

/**
 * DOM annotation of a mermaid state diagram SVG (scheme: docs/svg-scheme.md).
 * After `annotateSvg` every state element carries `data-scv-state="<mermaidId>"`
 * and every edge path / label group `data-scv-edge="<index>"`; highlighting
 * and click handling work on these attributes only.
 */

export const STATE_ATTR = "data-scv-state";
export const EDGE_ATTR = "data-scv-edge";
export const EVENT_ATTR = "data-scv-event";

export const ACTIVE_CLASS = "scv-active";
export const SELECTED_CLASS = "scv-selected";
export const ENABLED_CLASS = "scv-enabled";

const NODE_SELECTOR = "g.node";
const CLUSTER_SELECTOR = "g.statediagram-cluster";
const EDGE_PATH_SELECTOR = "path.transition[data-id]";
const EDGE_LABEL_SELECTOR = "g.edgeLabel";

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `<svgId>-state-<mermaidId>-<n>` → `<mermaidId>`; `null` for anything else. */
export function mermaidIdFromDomId(svgId: string, domId: string): string | null {
    const re = new RegExp(`^${escapeRegExp(svgId)}-state-(.+)-\\d+$`);
    return re.exec(domId)?.[1] ?? null;
}

export type ClickTarget = { kind: "state"; id: string } | { kind: "edge"; index: number };

/** Adds the `data-scv-*` attributes. Idempotent. */
export function annotateSvg(svg: SVGSVGElement, svgId: string, index: DiagramIndex): void {
    for (const node of svg.querySelectorAll<SVGGElement>(NODE_SELECTOR)) {
        const id = mermaidIdFromDomId(svgId, node.id);
        if (id !== null) node.setAttribute(STATE_ATTR, id);
    }
    for (const cluster of svg.querySelectorAll<SVGGElement>(CLUSTER_SELECTOR)) {
        const id = cluster.getAttribute("data-id");
        if (id) cluster.setAttribute(STATE_ATTR, id);
    }
    const annotateEdge = (element: Element, edgeId: string | null) => {
        const edge = edgeId ? index.byId.get(edgeId) : undefined;
        if (!edge) return;
        element.setAttribute(EDGE_ATTR, String(edge.index));
        if (edge.label.trigger.kind === "event") {
            element.setAttribute(EVENT_ATTR, edge.label.trigger.event);
        }
    };
    for (const path of svg.querySelectorAll<SVGPathElement>(EDGE_PATH_SELECTOR)) {
        annotateEdge(path, path.getAttribute("data-id"));
    }
    for (const label of svg.querySelectorAll<SVGGElement>(EDGE_LABEL_SELECTOR)) {
        annotateEdge(label, label.querySelector("g.label[data-id]")?.getAttribute("data-id") ?? null);
    }
}

export type HighlightState = {
    activeIds: ReadonlySet<string>;
    selectedId: string | null;
    enabledEdges: ReadonlySet<number>;
};

/** Toggles the highlight classes in place; cheap enough to run on every snapshot. */
export function applyHighlight(svg: SVGSVGElement, state: HighlightState): void {
    for (const element of svg.querySelectorAll<SVGElement>(`[${STATE_ATTR}]`)) {
        const id = element.getAttribute(STATE_ATTR) ?? "";
        element.classList.toggle(ACTIVE_CLASS, state.activeIds.has(id));
        element.classList.toggle(SELECTED_CLASS, id === state.selectedId);
    }
    for (const element of svg.querySelectorAll<SVGElement>(`[${EDGE_ATTR}]`)) {
        const index = Number(element.getAttribute(EDGE_ATTR));
        element.classList.toggle(ENABLED_CLASS, state.enabledEdges.has(index));
    }
}

/** Resolves a click inside the SVG to a state or an edge. */
export function resolveClickTarget(target: EventTarget | null): ClickTarget | null {
    if (!(target instanceof Element)) return null;
    const edge = target.closest(`[${EDGE_ATTR}]`);
    if (edge) return { kind: "edge", index: Number(edge.getAttribute(EDGE_ATTR)) };
    const state = target.closest(`[${STATE_ATTR}]`);
    if (state) return { kind: "state", id: state.getAttribute(STATE_ATTR) ?? "" };
    return null;
}
