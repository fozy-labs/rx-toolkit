import { describe, expect, it } from "vitest";

import { collectActivePaths, formatStateValue, mermaidIdOfPath, projectActiveIds } from "./stateValue";

describe("collectActivePaths", () => {
    it("lists parents before children", () => {
        expect(collectActivePaths("off")).toEqual([["off"]]);
        expect(collectActivePaths({ working: "green" })).toEqual([["working"], ["working", "green"]]);
        expect(collectActivePaths({ p: { $0: "a", $1: "c" } })).toEqual([
            ["p"],
            ["p", "$0"],
            ["p", "$0", "a"],
            ["p", "$1"],
            ["p", "$1", "c"],
        ]);
    });

    it("skips undefined map values (the library's StateValueMap admits them)", () => {
        expect(collectActivePaths({ p: { $0: "a", $1: undefined } })).toEqual([["p"], ["p", "$0"], ["p", "$0", "a"]]);
    });
});

describe("mermaidIdOfPath", () => {
    it("maps plain keys to themselves", () => {
        expect(mermaidIdOfPath(["working", "green"])).toBe("green");
    });

    it("skips region keys", () => {
        expect(mermaidIdOfPath(["p", "$0"])).toBeNull();
        expect(mermaidIdOfPath(["p", "$12"])).toBeNull();
    });

    it("maps $final to the parent's end node and the root final to root_end", () => {
        expect(mermaidIdOfPath(["working", "$final"])).toBe("working_end");
        expect(mermaidIdOfPath(["$final"])).toBe("root_end");
    });

    it("has no node for a region final", () => {
        expect(mermaidIdOfPath(["p", "$0", "$final"])).toBeNull();
    });
});

describe("projectActiveIds", () => {
    it("projects atomic, compound and parallel values", () => {
        expect([...projectActiveIds("off")]).toEqual(["off"]);
        expect([...projectActiveIds({ working: "green" })]).toEqual(["working", "green"]);
        expect([...projectActiveIds({ p: { $0: "a", $1: "c" } })]).toEqual(["p", "a", "c"]);
        expect([...projectActiveIds({ working: "$final" })]).toEqual(["working", "working_end"]);
        expect([...projectActiveIds({ p: { $0: "$final", $1: "d" } })]).toEqual(["p", "d"]);
        expect([...projectActiveIds("$final")]).toEqual(["root_end"]);
    });
});

describe("formatStateValue", () => {
    it("formats nested values", () => {
        expect(formatStateValue("off")).toBe("off");
        expect(formatStateValue({ working: "green" })).toBe("working.green");
        expect(formatStateValue({ p: { $0: "b", $1: "c" } })).toBe("p.($0.b | $1.c)");
        expect(formatStateValue({ p: { $0: "b", $1: undefined } })).toBe("p.($0.b)");
    });
});
