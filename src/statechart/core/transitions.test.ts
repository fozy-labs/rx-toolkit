import { unstable_createMachine as createMachine } from "../createMachine";
import { getMachineModel } from "../MachineDefinition";
import type { AnyEventObject, MachineContext } from "../types";

import type { MachineModel, StateNode, Transition } from "./model";
import {
    computeEntrySet,
    computeExitSet,
    getCandidates,
    getEffectiveTargetStates,
    getTransitionDomain,
    matchesEventDescriptor,
    removeConflictingTransitions,
    resolveHistoryDefaultTransition,
    type HistoryValue,
} from "./transitions";

type AnyModel = MachineModel<MachineContext, AnyEventObject>;
type AnyNode = StateNode<MachineContext, AnyEventObject>;
type AnyTransition = Transition<MachineContext, AnyEventObject>;
type AnyHistory = HistoryValue<MachineContext, AnyEventObject>;

const model: AnyModel = getMachineModel(
    createMachine({
        id: "t",
        initial: "a",
        on: { RESET: { target: ".a", reenter: true }, ROOT_SELF: "#t" },
        states: {
            a: {
                initial: "a1",
                on: {
                    INTERNAL: ".a2",
                    EXTERNAL: { target: ".a2", reenter: true },
                    SELF: "a",
                    SELF_RE: { target: "a", reenter: true },
                    HIST: ".ah",
                    HIST_DEFAULT: ".ad",
                    TARGETLESS: { actions: "x" },
                    TO_ROOT: "#t",
                },
                states: {
                    a1: {
                        on: {
                            NEXT: "a2",
                            "*": "a2",
                            "user.*": "a2",
                            "user.login": "a2",
                            "user.login.*": "a2",
                            TO_B: "#t.b",
                            TO_X2: "#t.p.x.x2",
                        },
                    },
                    a2: {},
                    ah: { type: "history" },
                    ad: { type: "history", target: "a2" },
                },
            },
            b: { on: { TO_A2: "#t.a.a2", TO_AH: "#t.a.ah", TO_X2: "#t.p.x.x2", TO_PH: "#t.p.ph" } },
            p: {
                type: "parallel",
                on: { LEAVE: "b" },
                states: {
                    x: { initial: "x1", states: { x1: { on: { CROSS: "#t.p.y.y2", X: "x2" } }, x2: {} } },
                    y: { initial: "y1", states: { y1: { on: { CROSS: "y2", Y: "y2" } }, y2: {} } },
                    ph: { type: "history" },
                },
            },
        },
    }),
);

const n = (id: string): AnyNode => {
    const found = model.idMap.get(id);
    if (found === undefined) throw new Error(`test: node '${id}' not found`);
    return found;
};
const ids = (nodes: Iterable<AnyNode>): string[] => [...nodes].map((node) => node.id);
const t = (id: string, eventType: string, index = 0): AnyTransition => {
    const list = n(id).transitions.get(eventType);
    if (list?.[index] === undefined) throw new Error(`test: no transition ${eventType}[${index}] on ${id}`);
    return list[index];
};
const config = (...nodeIds: string[]): ReadonlySet<AnyNode> => new Set(nodeIds.map(n));
const noHistory: AnyHistory = {};

describe("matchesEventDescriptor", () => {
    it("matches exact descriptors and the catch-all", () => {
        expect(matchesEventDescriptor("a", "a")).toBe(true);
        expect(matchesEventDescriptor("a", "b")).toBe(false);
        expect(matchesEventDescriptor("anything", "*")).toBe(true);
    });

    it("matches partial wildcards by leading tokens (XState semantics)", () => {
        expect(matchesEventDescriptor("user.login", "user.*")).toBe(true);
        expect(matchesEventDescriptor("user.login.extra", "user.*")).toBe(true);
        expect(matchesEventDescriptor("admin.login", "user.*")).toBe(false);
        expect(matchesEventDescriptor("a.b.c.d", "a.b.*")).toBe(true);
        expect(matchesEventDescriptor("a.c", "a.b.*")).toBe(false);
        // XState quirk kept on purpose: the trailing wildcard matches a missing token too.
        expect(matchesEventDescriptor("user", "user.*")).toBe(true);
    });

    it("never matches infix wildcards or a bare non-descriptor", () => {
        expect(matchesEventDescriptor("a.x.b", "a.*.b")).toBe(false);
        expect(matchesEventDescriptor("user.login", "user*")).toBe(false);
    });
});

describe("getCandidates", () => {
    it("lists the exact descriptor first, then matching wildcards from longest to shortest", () => {
        const candidates = getCandidates(n("t.a.a1"), "user.login");
        expect(candidates.map((c) => c.eventType)).toEqual(["user.login", "user.login.*", "user.*", "*"]);
        expect(getCandidates(n("t.a.a1"), "user.logout").map((c) => c.eventType)).toEqual(["user.*", "*"]);
        expect(getCandidates(n("t.a.a1"), "OTHER").map((c) => c.eventType)).toEqual(["*"]);
        expect(getCandidates(n("t.a.a1"), "NEXT").map((c) => c.eventType)).toEqual(["NEXT", "*"]);
    });

    it("returns an empty frozen list for nodes without matching descriptors", () => {
        expect(getCandidates(n("t.a.a2"), "NEXT")).toEqual([]);
        expect(Object.isFrozen(getCandidates(n("t.a.a1"), "NEXT"))).toBe(true);
    });

    it("computes candidates fresh on every call instead of caching per event type", () => {
        // Regression: getCandidates used to memoize per (node, event type) with no
        // bound or eviction. StateNodes live as long as the MachineDefinition's
        // model (typically a module-level singleton), so apps sending dynamically
        // named events (e.g. "item.<id>.updated") or probing can() with arbitrary
        // types leaked one permanent Map entry per distinct event type per node.
        const first = getCandidates(n("t.a.a1"), "NEXT");
        const second = getCandidates(n("t.a.a1"), "NEXT");
        expect(second).toEqual(first);
        expect(second).not.toBe(first);
    });
});

describe("resolveHistoryDefaultTransition / getEffectiveTargetStates", () => {
    it("uses the history's own target, the parallel parent, or the compound parent's initial", () => {
        expect(resolveHistoryDefaultTransition(n("t.a.ad"))).toEqual({ target: [n("t.a.a2")], isParentInitial: false });
        expect(resolveHistoryDefaultTransition(n("t.a.ah"))).toEqual({ target: [n("t.a.a1")], isParentInitial: true });
        expect(resolveHistoryDefaultTransition(n("t.p.ph"))).toEqual({ target: [n("t.p")], isParentInitial: false });
    });

    it("replaces history targets with the recorded nodes, else the defaults; null targets give []", () => {
        expect(getEffectiveTargetStates(null, noHistory)).toEqual([]);
        expect(ids(getEffectiveTargetStates([n("t.a.ah")], noHistory))).toEqual(["t.a.a1"]);
        expect(ids(getEffectiveTargetStates([n("t.a.ah")], { "t.a.ah": [n("t.a.a2")] }))).toEqual(["t.a.a2"]);
        expect(ids(getEffectiveTargetStates([n("t.p.ph")], noHistory))).toEqual(["t.p"]);
        expect(ids(getEffectiveTargetStates([n("t.a.a1"), n("t.a.a1")], noHistory))).toEqual(["t.a.a1"]);
        // a prototype key is not a recorded history
        expect(
            ids(getEffectiveTargetStates([n("t.a.ah")], Object.create({ "t.a.ah": [n("t.a.a2")] }) as AnyHistory)),
        ).toEqual(["t.a.a1"]);
    });
});

describe("getTransitionDomain", () => {
    it("is the source for internal transitions (targets inside the source, no reenter)", () => {
        expect(getTransitionDomain(t("t.a", "INTERNAL"), noHistory)).toBe(n("t.a"));
        expect(getTransitionDomain(t("t.a", "SELF"), noHistory)).toBe(n("t.a"));
        expect(getTransitionDomain(t("t.a", "TARGETLESS"), noHistory)).toBe(n("t.a"));
        expect(getTransitionDomain(t("t.a", "HIST"), noHistory)).toBe(n("t.a"));
    });

    it("is the least common ancestor of source and effective targets otherwise", () => {
        expect(getTransitionDomain(t("t.a.a1", "NEXT"), noHistory)).toBe(n("t.a"));
        expect(getTransitionDomain(t("t.a.a1", "TO_B"), noHistory)).toBe(model.root);
        expect(getTransitionDomain(t("t.a", "EXTERNAL"), noHistory)).toBe(model.root);
        expect(getTransitionDomain(t("t.a", "SELF_RE"), noHistory)).toBe(model.root);
        expect(getTransitionDomain(t("t.p.x.x1", "CROSS"), noHistory)).toBe(n("t.p"));
        expect(getTransitionDomain(t("t", "ROOT_SELF"), noHistory)).toBe(model.root);
    });

    it("is null (no domain) for a root-sourced reenter transition and the root when the LCA is missing", () => {
        expect(getTransitionDomain(t("t", "RESET"), noHistory)).toBeNull();
        expect(getTransitionDomain(t("t.a", "TO_ROOT"), noHistory)).toBe(model.root);
    });
});

describe("computeExitSet", () => {
    it("exits the active descendants of the domain; targetless transitions exit nothing", () => {
        const active = config("t", "t.a", "t.a.a1");
        expect(ids(computeExitSet([t("t.a.a1", "NEXT")], active, noHistory))).toEqual(["t.a.a1"]);
        expect(ids(computeExitSet([t("t.a", "INTERNAL")], active, noHistory))).toEqual(["t.a.a1"]);
        expect(ids(computeExitSet([t("t.a.a1", "TO_B")], active, noHistory))).toEqual(["t.a", "t.a.a1"]);
        expect(computeExitSet([t("t.a", "TARGETLESS")], active, noHistory)).toEqual([]);
    });

    it("adds the source itself when it re-enters within its own domain", () => {
        const active = config("t", "t.a", "t.a.a1");
        expect(ids(computeExitSet([t("t.a", "SELF_RE")], active, noHistory))).toEqual(["t.a", "t.a.a1"]);
        // the domain is the root and the source is `a`, so the `reenter && source === domain` rule does not apply,
        // but `a` is a descendant of the root anyway
        expect(ids(computeExitSet([t("t.a", "EXTERNAL")], active, noHistory))).toEqual(["t.a", "t.a.a1"]);
    });

    it("exits everything, root included, for a root-sourced reenter transition", () => {
        const active = config("t", "t.a", "t.a.a1");
        expect(ids(computeExitSet([t("t", "RESET")], active, noHistory))).toEqual(["t", "t.a", "t.a.a1"]);
    });

    it("unions the exit sets of several transitions", () => {
        const active = config("t", "t.p", "t.p.x", "t.p.x.x1", "t.p.y", "t.p.y.y1");
        expect(ids(computeExitSet([t("t.p.x.x1", "X"), t("t.p.y.y1", "Y")], active, noHistory))).toEqual([
            "t.p.x.x1",
            "t.p.y.y1",
        ]);
    });
});

describe("removeConflictingTransitions", () => {
    const active = config("t", "t.p", "t.p.x", "t.p.x.x1", "t.p.y", "t.p.y.y1");

    it("keeps non-overlapping transitions in order", () => {
        const kept = removeConflictingTransitions([t("t.p.x.x1", "X"), t("t.p.y.y1", "Y")], active, noHistory);
        expect(kept).toEqual([t("t.p.x.x1", "X"), t("t.p.y.y1", "Y")]);
    });

    it("lets the earlier transition preempt a later overlapping one from an unrelated node", () => {
        // CROSS from x1 exits the whole parallel state (domain p), overlapping y1's own CROSS
        const kept = removeConflictingTransitions([t("t.p.x.x1", "CROSS"), t("t.p.y.y1", "CROSS")], active, noHistory);
        expect(kept).toEqual([t("t.p.x.x1", "CROSS")]);
    });

    it("lets a descendant's transition replace an ancestor's overlapping one", () => {
        const kept = removeConflictingTransitions([t("t.p", "LEAVE"), t("t.p.x.x1", "X")], active, noHistory);
        expect(kept).toEqual([t("t.p.x.x1", "X")]);
    });
});

describe("computeEntrySet", () => {
    it("enters the target and its initial descendants for a sibling transition", () => {
        const entry = computeEntrySet([t("t.a.a1", "TO_B")], noHistory);
        expect(ids(entry.statesToEnter)).toEqual(["t.b"]);
        expect(ids(entry.statesForDefaultEntry)).toEqual(["t.b"]);
    });

    it("enters only the initial child for an internal self-transition, the source too when re-entering", () => {
        const internal = computeEntrySet([t("t.a", "SELF")], noHistory);
        expect(ids(internal.statesToEnter)).toEqual(["t.a.a1"]);
        expect(ids(internal.statesForDefaultEntry)).toEqual(["t.a.a1"]);
        const reenter = computeEntrySet([t("t.a", "SELF_RE")], noHistory);
        expect(ids(reenter.statesToEnter)).toEqual(["t.a", "t.a.a1"]);
    });

    it("adds ancestors of a deep target without marking them for default entry", () => {
        const entry = computeEntrySet([t("t.b", "TO_A2")], noHistory);
        expect(ids(entry.statesToEnter).sort()).toEqual(["t.a", "t.a.a2"]);
        expect(ids(entry.statesForDefaultEntry)).toEqual(["t.a.a2"]);
    });

    it("enters the root as well for a root-sourced reenter transition", () => {
        const entry = computeEntrySet([t("t", "RESET")], noHistory);
        expect(ids(entry.statesToEnter).sort()).toEqual(["t", "t.a", "t.a.a1"]);
    });

    it("fills the other regions of a parallel ancestor with their initial states", () => {
        const entry = computeEntrySet([t("t.b", "TO_X2")], noHistory);
        expect(ids(entry.statesToEnter).sort()).toEqual(["t.p", "t.p.x", "t.p.x.x2", "t.p.y", "t.p.y.y1"]);
        expect(ids(entry.statesForDefaultEntry).sort()).toEqual(["t.p.x.x2", "t.p.y.y1"]);
    });

    it("resolves history targets: recorded nodes, else the default (parent initial / own target / parallel parent)", () => {
        const fresh = computeEntrySet([t("t.a", "HIST")], noHistory);
        expect(ids(fresh.statesToEnter)).toEqual(["t.a.a1"]);
        // the parent's initial transition was used, so the parent joins statesForDefaultEntry (XState)
        expect(ids(fresh.statesForDefaultEntry)).toEqual(["t.a"]);

        const recorded = computeEntrySet([t("t.a", "HIST")], { "t.a.ah": [n("t.a.a2")] });
        expect(ids(recorded.statesToEnter)).toEqual(["t.a.a2"]);
        expect(ids(recorded.statesForDefaultEntry)).toEqual([]);

        const withDefault = computeEntrySet([t("t.a", "HIST_DEFAULT")], noHistory);
        expect(ids(withDefault.statesToEnter)).toEqual(["t.a.a2"]);

        const parallelHistory = computeEntrySet([t("t.b", "TO_PH")], noHistory);
        expect(ids(parallelHistory.statesToEnter).sort()).toEqual(["t.p", "t.p.x", "t.p.x.x1", "t.p.y", "t.p.y.y1"]);

        const parallelRecorded = computeEntrySet([t("t.b", "TO_PH")], { "t.p.ph": [n("t.p.x"), n("t.p.y")] });
        expect(ids(parallelRecorded.statesToEnter).sort()).toEqual(["t.p", "t.p.x", "t.p.x.x1", "t.p.y", "t.p.y.y1"]);
    });

    it("enters nothing for a targetless transition", () => {
        const entry = computeEntrySet([t("t.a", "TARGETLESS")], noHistory);
        expect(entry.statesToEnter.size).toBe(0);
        expect(entry.statesForDefaultEntry.size).toBe(0);
    });
});
