import { ACTIVE_CLASS, EDGE_ATTR, ENABLED_CLASS, EVENT_ATTR, SELECTED_CLASS, STATE_ATTR } from "./core/svgIndex";

/**
 * Component styles, injected once per instance. Colours are CSS custom
 * properties so hosts can re-theme without fighting specificity.
 */
export const BASE_CSS = `
.scv {
    --scv-active: #d0342c;
    --scv-active-fill: #fff0ee;
    --scv-selected: #1a6ee0;
    --scv-enabled: #1f8a3b;
    --scv-muted: #7a7a7a;
    --scv-border: #d9d9d9;
    --scv-error: #b00020;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #222;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 480px;
    height: 100%;
    box-sizing: border-box;
}
.scv *, .scv *::before, .scv *::after { box-sizing: inherit; }
.scv-header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
.scv-title { font-weight: 600; font-size: 15px; margin: 0; }
.scv-status { color: var(--scv-muted); }
.scv-value { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.scv-body { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 8px; flex: 1; min-height: 0; }
.scv-diagram { position: relative; border: 1px solid var(--scv-border); border-radius: 6px; background: #fff; min-height: 420px; overflow: hidden; }
.scv-diagram > svg { display: block; width: 100%; height: 100%; }
.scv-message { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; text-align: center; color: var(--scv-muted); }
.scv-message.scv-error { color: var(--scv-error); white-space: pre-wrap; }
.scv-side { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow: auto; }
.scv-panel { border: 1px solid var(--scv-border); border-radius: 6px; padding: 8px 10px; background: #fafafa; }
.scv-panel-title { margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: #555; }
.scv-hint { margin: 0; color: var(--scv-muted); }
.scv-notice { margin: 0; color: var(--scv-error); white-space: pre-wrap; }
.scv-events { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 6px; }
.scv-event { font: inherit; padding: 4px 9px; border: 1px solid #b5b5b5; border-radius: 4px; background: #fff; cursor: pointer; }
.scv-event:hover:not(:disabled) { border-color: var(--scv-enabled); color: var(--scv-enabled); }
.scv-event:disabled { cursor: not-allowed; opacity: 0.45; }
.scv-payload-label { display: block; margin-top: 6px; color: var(--scv-muted); }
.scv-payload { display: block; width: 100%; margin-top: 3px; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical; }
.scv-payload-error { margin: 4px 0 0; color: var(--scv-error); }
.scv-log { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow: auto; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.scv-log li { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: baseline; }
.scv-log time { color: var(--scv-muted); }
.scv-log .scv-rejected { color: var(--scv-muted); text-decoration: line-through; }
.scv-context { margin: 0; max-height: 240px; overflow: auto; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; }
`;

/**
 * Rules for one rendered diagram. Mermaid scopes its own rules with the svg id
 * (`#<svgId> .node rect`, specificity 1,1,1); these use the same id plus the
 * toggled class, so they win without `!important`.
 */
export function diagramCss(svgId: string): string {
    const s = `#${svgId}`;
    const node = `${s} g.node`;
    const cluster = `${s} g.statediagram-cluster`;
    return `
${s} [${STATE_ATTR}] { cursor: pointer; }
${s} [${EDGE_ATTR}] { cursor: default; }
${s} [${EVENT_ATTR}].${ENABLED_CLASS} { cursor: pointer; }
${node}.${ACTIVE_CLASS} > rect, ${node}.${ACTIVE_CLASS} > g > path { stroke: var(--scv-active); stroke-width: 2.5px; fill: var(--scv-active-fill); }
${cluster}.${ACTIVE_CLASS} rect.outer { stroke: var(--scv-active); stroke-width: 2.5px; }
${node}.${SELECTED_CLASS} > rect, ${node}.${SELECTED_CLASS} > g > path { stroke: var(--scv-selected); stroke-width: 2.5px; stroke-dasharray: 5 3; }
${cluster}.${SELECTED_CLASS} rect.outer { stroke: var(--scv-selected); stroke-width: 2.5px; stroke-dasharray: 5 3; }
${s} path.transition.${ENABLED_CLASS} { stroke: var(--scv-enabled); stroke-width: 2.5px; }
${s} g.edgeLabel.${ENABLED_CLASS} .label span.edgeLabel { color: var(--scv-enabled); text-decoration: underline; }
`;
}
