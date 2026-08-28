import type { VizFixture } from "./types";

export type ParallelContext = { ok: boolean };

const source = `stateDiagram-v2
    %% @machine parallelDemo
    %% @context type: { ok: boolean }
    %% @context initial: { ok: true }
    [*] --> idle
    idle --> p: START
    state p {
        [*] --> a
        a --> b: NEXT_A
        b --> [*]: FIN_A
        --
        [*] --> c
        c --> d: NEXT_C
        d --> [*]: FIN_C
    }
    p --> idle: STOP
    p --> finished: done
    state "All regions finished" as finished
    finished --> [*]: FINISH
    state c1 <<choice>>
    finished --> c1: CHECK
    %% @guard ok: context.ok
    %% @guard retry: !context.ok
    c1 --> idle: [ok]
    c1 --> p: [retry]
`;

/**
 * Parallel regions (`$0`/`$1`), region finals, a described state, a choice
 * state (`always` candidates) and a root `$final`.
 */
export const parallelFixture: VizFixture<ParallelContext> = {
    name: "parallel",
    source,
    config: {
        id: "parallelDemo",
        source,
        initial: "idle",
        states: {
            idle: { on: { START: "p" } },
            p: {
                type: "parallel",
                on: { STOP: "idle" },
                onDone: "finished",
                states: {
                    $0: {
                        initial: "a",
                        states: {
                            a: { on: { NEXT_A: "b" } },
                            b: { on: { FIN_A: "$final" } },
                            $final: { type: "final" },
                        },
                    },
                    $1: {
                        initial: "c",
                        states: {
                            c: { on: { NEXT_C: "d" } },
                            d: { on: { FIN_C: "$final" } },
                            $final: { type: "final" },
                        },
                    },
                },
            },
            finished: { description: "All regions finished", on: { CHECK: "c1", FINISH: "$final" } },
            c1: {
                always: [
                    { target: "idle", guard: "ok" },
                    { target: "p", guard: "retry" },
                ],
            },
            $final: { type: "final" },
        },
    },
    context: { ok: true },
    guards: {
        ok: ({ context }) => context.ok,
        retry: ({ context }) => !context.ok,
    },
};
