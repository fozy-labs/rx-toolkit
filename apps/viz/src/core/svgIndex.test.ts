import { afterEach, describe, expect, it } from "vitest";

import type { DiagramIndex } from "./mermaidGraph";
import {
    ACTIVE_CLASS,
    annotateSvg,
    applyHighlight,
    ENABLED_CLASS,
    mermaidIdFromDomId,
    resolveClickTarget,
    SELECTED_CLASS,
} from "./svgIndex";
import { parseTransitionLabel } from "./transitionLabel";

// Mirrors the structure recorded in docs/svg-scheme.md.
const SVG = `
<svg id="scv-1" class="statediagram">
  <g><g class="root">
    <g class="clusters">
      <g class="statediagram-state statediagram-cluster" id="scv-1-state-working-5" data-id="working">
        <g><rect class="outer"/></g><g class="cluster-label"><foreignObject><div><span>working</span></div></foreignObject></g><rect class="inner"/>
      </g>
      <g class="statediagram-state statediagram-cluster statediagram-cluster-alt" id="scv-1-state-divider-id-1-2"><g><rect class="divider"/></g></g>
    </g>
    <g class="edgePaths">
      <path id="scv-1-edge0" class="transition" data-id="edge0"/>
      <path id="scv-1-edge1" class="transition" data-id="edge1"/>
      <path id="scv-1-edge2" class="transition" data-id="edge2"/>
    </g>
    <g class="edgeLabels">
      <g class="edgeLabel"><g class="label" data-id="edge1"><foreignObject><div><span class="edgeLabel"><p>POWER_ON [hasPower] / logStart</p></span></div></foreignObject></g></g>
      <g class="edgeLabel"><g class="label" data-id="edge2"><foreignObject><div><span class="edgeLabel"><p>after 3000</p></span></div></foreignObject></g></g>
    </g>
    <g class="nodes">
      <g class="node default" id="scv-1-state-root_start-0"><circle class="state-start"/></g>
      <g class="node  statediagram-state" id="scv-1-state-off-4"><rect class="basic label-container"/><g class="label"><foreignObject><div><span class="nodeLabel"><p>off</p></span></div></foreignObject></g></g>
      <g class="node  statediagram-state" id="scv-1-state-green-8"><rect class="basic label-container"/></g>
      <g class="node default" id="scv-1-state-working_end-9"><g class="outer-path"><path/></g></g>
    </g>
  </g></g>
</svg>`;

function makeIndex(): DiagramIndex {
    const edges = [
        { index: 0, id: "edge0", start: "root_start", end: "off", label: parseTransitionLabel("") },
        {
            index: 1,
            id: "edge1",
            start: "off",
            end: "working",
            label: parseTransitionLabel("POWER_ON [hasPower] / logStart"),
        },
        { index: 2, id: "edge2", start: "green", end: "yellow", label: parseTransitionLabel("after 3000") },
    ];
    return { edges, byId: new Map(edges.map((e) => [e.id, e])) };
}

// Every test mounts its own copy; the body must be empty in between, because
// jsdom resolves `#id` selectors through getElementById and would find the
// stale copy outside the queried svg.
afterEach(() => {
    document.body.innerHTML = "";
});

function mount(): SVGSVGElement {
    const host = document.createElement("div");
    host.innerHTML = SVG;
    document.body.appendChild(host);
    return host.querySelector("svg") as SVGSVGElement;
}

describe("mermaidIdFromDomId", () => {
    it("strips the svg id prefix and the counter suffix", () => {
        expect(mermaidIdFromDomId("scv-1", "scv-1-state-off-4")).toBe("off");
        expect(mermaidIdFromDomId("scv-1", "scv-1-state-s1-3")).toBe("s1");
        expect(mermaidIdFromDomId("scv-1", "scv-1-state-working_end-9")).toBe("working_end");
        expect(mermaidIdFromDomId("scv-1", "scv-1-state-id-n2331etg9vo-2_end-7")).toBe("id-n2331etg9vo-2_end");
    });

    it("rejects ids of other svgs and non-state ids", () => {
        expect(mermaidIdFromDomId("scv-1", "scv-10-state-off-4")).toBeNull();
        expect(mermaidIdFromDomId("scv-1", "scv-1-edge1")).toBeNull();
    });
});

describe("annotateSvg", () => {
    it("marks nodes, clusters, edge paths and edge labels", () => {
        const svg = mount();
        annotateSvg(svg, "scv-1", makeIndex());

        const states = [...svg.querySelectorAll("[data-scv-state]")].map((e) => e.getAttribute("data-scv-state"));
        expect(states).toEqual(["working", "root_start", "off", "green", "working_end"]);

        const edges = [...svg.querySelectorAll("[data-scv-edge]")].map(
            (e) => `${e.tagName}:${e.getAttribute("data-scv-edge")}:${e.getAttribute("data-scv-event") ?? "-"}`,
        );
        expect(edges).toEqual(["path:0:-", "path:1:POWER_ON", "path:2:-", "g:1:POWER_ON", "g:2:-"]);
    });

    it("is idempotent", () => {
        const svg = mount();
        annotateSvg(svg, "scv-1", makeIndex());
        annotateSvg(svg, "scv-1", makeIndex());
        expect(svg.querySelectorAll("[data-scv-state]").length).toBe(5);
    });
});

describe("applyHighlight", () => {
    it("toggles classes and clears them again", () => {
        const svg = mount();
        annotateSvg(svg, "scv-1", makeIndex());
        const off = svg.querySelector("#scv-1-state-off-4")!;
        const working = svg.querySelector("#scv-1-state-working-5")!;
        const edge1 = svg.querySelector("#scv-1-edge1")!;
        const label1 = svg.querySelector('g.edgeLabel:has(g.label[data-id="edge1"])')!;

        applyHighlight(svg, { activeIds: new Set(["off"]), selectedId: "working", enabledEdges: new Set([1]) });
        expect(off.classList.contains(ACTIVE_CLASS)).toBe(true);
        expect(working.classList.contains(ACTIVE_CLASS)).toBe(false);
        expect(working.classList.contains(SELECTED_CLASS)).toBe(true);
        expect(edge1.classList.contains(ENABLED_CLASS)).toBe(true);
        expect(label1.classList.contains(ENABLED_CLASS)).toBe(true);

        applyHighlight(svg, { activeIds: new Set(["working", "green"]), selectedId: null, enabledEdges: new Set() });
        expect(off.classList.contains(ACTIVE_CLASS)).toBe(false);
        expect(working.classList.contains(ACTIVE_CLASS)).toBe(true);
        expect(working.classList.contains(SELECTED_CLASS)).toBe(false);
        expect(edge1.classList.contains(ENABLED_CLASS)).toBe(false);
        expect(label1.classList.contains(ENABLED_CLASS)).toBe(false);
    });
});

describe("resolveClickTarget", () => {
    it("resolves paths, label text, node bodies and cluster parts", () => {
        const svg = mount();
        annotateSvg(svg, "scv-1", makeIndex());
        expect(resolveClickTarget(svg.querySelector("#scv-1-edge1"))).toEqual({ kind: "edge", index: 1 });
        expect(resolveClickTarget(svg.querySelector('g.label[data-id="edge2"] p'))).toEqual({ kind: "edge", index: 2 });
        expect(resolveClickTarget(svg.querySelector("#scv-1-state-off-4 p"))).toEqual({ kind: "state", id: "off" });
        expect(resolveClickTarget(svg.querySelector("#scv-1-state-working-5 rect.inner"))).toEqual({
            kind: "state",
            id: "working",
        });
        expect(resolveClickTarget(svg.querySelector("#scv-1-state-working-5 .cluster-label span"))).toEqual({
            kind: "state",
            id: "working",
        });
    });

    it("ignores regions, the background and non-elements", () => {
        const svg = mount();
        annotateSvg(svg, "scv-1", makeIndex());
        expect(resolveClickTarget(svg.querySelector("rect.divider"))).toBeNull();
        expect(resolveClickTarget(svg)).toBeNull();
        expect(resolveClickTarget(null)).toBeNull();
    });
});
