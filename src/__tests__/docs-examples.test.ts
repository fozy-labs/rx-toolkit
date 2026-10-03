/**
 * Verbatim code snippets from the docs, kept compiling so doc drift fails here:
 * - docs/statechart/README.md — the `MachineImplementations` interface (generic arguments);
 * - docs/query/usage/plugins.md — the `loggingPlugin` example (`getEntry` typed parameters).
 */
import { describe, expect, it } from "vitest";

import type { IPlugin } from "@/query/types";
import type {
    ActionImplementation,
    DelayImplementation,
    EventObject,
    GuardImplementation,
    MachineContext,
    MachineImplementations,
} from "@/statechart/types";

// docs/statechart/README.md — «Реализации: actions, guards, delays»
interface DocMachineImplementations<TContext extends MachineContext, TEvent extends EventObject> {
    actions?: Record<string, ActionImplementation<TContext, TEvent>>; // (args, params) => void  |  builtin-действие
    guards?: Record<string, GuardImplementation<TContext, TEvent>>; // (args, params) => boolean |  builtin-гвард
    delays?: Record<string, DelayImplementation<TContext, TEvent>>; // number | (args, params) => number
}

// The documented shape must stay assignable to the real interface.
type _AssertDocShapeMatches<TContext extends MachineContext, TEvent extends EventObject> =
    DocMachineImplementations<TContext, TEvent> extends MachineImplementations<TContext, TEvent> ? true : never;
const _docShapeMatches: _AssertDocShapeMatches<Record<string, unknown>, { type: "X" }> = true;

// docs/query/usage/plugins.md — the `loggingPlugin` example
const loggingPlugin: IPlugin = {
    name: "LoggingPlugin",
    install() {},
    augmentResource(resource) {
        return {
            logState(args: Parameters<typeof resource.getEntry>[0]) {
                // Упрощённый пример — getEntry принимает аргументы для идентификации кэш-записи
                console.log(resource.getEntry(args));
            },
        };
    },
};

describe("docs examples", () => {
    it("typecheck", () => {
        expect(_docShapeMatches).toBe(true);
        expect(loggingPlugin.name).toBe("LoggingPlugin");
    });
});
