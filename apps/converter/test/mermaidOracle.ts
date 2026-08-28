/**
 * Differential oracle: the pinned mermaid (11.17.2) parsing a diagram under
 * Node with jsdom globals (mermaid needs `window` / `document` / `DOMParser`
 * at import time; `render` is not used — it needs `getBBox`). Exposes the raw
 * statement tree (`getRootDocV2()`), the render-time node list (`getData()`,
 * the source of truth for which block a state is drawn in) and the relations.
 */
import { JSDOM } from "jsdom";
import type mermaidDefault from "mermaid";

export interface MermaidStateRef {
    stmt: "state";
    id: string;
    type?: string;
    description?: string;
    start?: boolean;
}

export interface MermaidRelation {
    stmt: "relation";
    state1: MermaidStateRef;
    state2: MermaidStateRef;
    description?: string;
}

export interface MermaidStateStatement {
    stmt: "state";
    id: string;
    type?: string;
    description?: string;
    doc?: MermaidStatement[];
    note?: { position: string; text: string };
}

export interface MermaidOtherStatement {
    stmt: "dir" | "classDef" | "applyClass" | "style" | "click";
    [key: string]: unknown;
}

export type MermaidStatement = MermaidRelation | MermaidStateStatement | MermaidOtherStatement | string;

export interface MermaidNode {
    id: string;
    parentId?: string;
    shape?: string;
    isGroup?: boolean;
}

export interface MermaidParsed {
    doc: MermaidStatement[];
    nodes: MermaidNode[];
    relations: Array<{ id1: string; id2: string; relationTitle?: string }>;
    /** Ids of every state mermaid registered (declared or referenced). */
    states: string[];
}

interface StateDb {
    getRootDocV2(): { doc: MermaidStatement[] };
    getData(): { nodes: MermaidNode[] };
    getRelations(): Array<{ id1: string; id2: string; relationTitle?: string }>;
    getStates(): Map<string, unknown>;
}

type MermaidModule = typeof mermaidDefault;

let loading: Promise<MermaidModule> | null = null;

function installDomGlobals(): void {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { pretendToBeVisual: true });
    const target = globalThis as unknown as Record<string, unknown>;
    const window = dom.window as unknown as Record<string, unknown>;
    for (const key of ["window", "document", "DOMParser", "Element", "SVGElement", "HTMLElement", "navigator"]) {
        if (!(key in globalThis)) target[key] = window[key];
    }
}

function loadMermaid(): Promise<MermaidModule> {
    loading ??= (async () => {
        installDomGlobals();
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
        return mermaid;
    })();
    return loading;
}

/** Parses `text` with mermaid; rejects with mermaid's own parse error when the text is not valid mermaid. */
export async function mermaidStateDiagram(text: string): Promise<MermaidParsed> {
    const mermaid = await loadMermaid();
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(text);
    if (diagram.type !== "stateDiagram") throw new Error(`expected a stateDiagram, mermaid detected ${diagram.type}`);
    const db = diagram.db as unknown as StateDb;
    return {
        doc: db.getRootDocV2().doc,
        nodes: db.getData().nodes.map((node) => ({
            id: node.id,
            parentId: node.parentId,
            shape: node.shape,
            isGroup: node.isGroup,
        })),
        relations: db.getRelations().map((relation) => ({
            id1: relation.id1,
            id2: relation.id2,
            relationTitle: relation.relationTitle,
        })),
        states: [...db.getStates().keys()],
    };
}

/** Whether mermaid accepts `text` at all (a parse error rejects). */
export async function mermaidAccepts(text: string): Promise<boolean> {
    try {
        await mermaidStateDiagram(text);
        return true;
    } catch {
        return false;
    }
}
