import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandV2 } from "@/query-v2/core/command/CommandV2";
import type { TCommandQueryFn, TCommandV2Options } from "@/query-v2/types";

type TArgs = { id: number };
type TResult = { name: string };

function createOptions(overrides?: Partial<TCommandV2Options<TArgs, TResult>>): TCommandV2Options<TArgs, TResult> {
    const queryFn: TCommandQueryFn<TArgs, TResult> = vi.fn(() => Promise.resolve({ name: "test" }));
    return { queryFn, ...overrides };
}

describe("CommandV2", () => {
    // ── T10: createAgent returns object with expected shape ──
    it("T10: createAgent() returns object with state$, trigger, reset", () => {
        const command = new CommandV2<TArgs, TResult>(createOptions());

        const agent = command.createAgent();

        expect(agent).toBeDefined();
        expect(typeof agent.state$).toBe("function");
        expect(typeof agent.trigger).toBe("function");
        expect(typeof agent.reset).toBe("function");
    });

    // ── T11: resetCache clears all entries ──
    it("T11: resetCache() clears all cache entries", () => {
        const command = new CommandV2<TArgs, TResult>(createOptions());

        // Create entries via internal method
        const key1 = Symbol("agent1");
        const key2 = Symbol("agent2");
        const entry1 = command._getOrCreateEntry(key1);
        const entry2 = command._getOrCreateEntry(key2);

        const completeSpy1 = vi.spyOn(entry1, "complete");
        const completeSpy2 = vi.spyOn(entry2, "complete");

        command.resetCache();

        expect(completeSpy1).toHaveBeenCalled();
        expect(completeSpy2).toHaveBeenCalled();

        // After reset, _getOrCreateEntry returns a NEW entry (not the old one)
        const entry1Again = command._getOrCreateEntry(key1);
        expect(entry1Again).not.toBe(entry1);
    });

    // ── T12: Multiple agents share same Command but have independent entries ──
    it("T12: multiple createAgent() calls produce independent agents with unique entries", () => {
        const command = new CommandV2<TArgs, TResult>(createOptions());

        const agent1 = command.createAgent();
        const agent2 = command.createAgent();

        expect(agent1).not.toBe(agent2);
    });

    // ── T13: devtoolsName stored ──
    it("T13: devtoolsName from options is stored", () => {
        const command = new CommandV2<TArgs, TResult>(createOptions({ devtoolsName: "myCommand" }));

        expect(command.devtoolsName).toBe("myCommand");
    });
});
