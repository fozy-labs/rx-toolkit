import type { VizFixture } from "./types";

export type SquareContext = { result: number | null; error: string | null };

const source = `stateDiagram-v2
    %% @machine square
    %% @context type: { result: number | null; error: string | null }
    %% @context initial: { result: null, error: null }
    %% @event SQUARE: { value: number }

    [*] --> idle

    %% @guard isFinite: Number.isFinite(event.value)
    %% @action square:
    %%     context.result = event.value ** 2
    %%     context.error = null
    idle --> done: SQUARE [isFinite] / square

    %% @action reject: context.error = "not a finite number"
    idle --> error: SQUARE / reject

    %% @action clear:
    %%     context.result = null
    %%     context.error = null
    done --> idle: RESET / clear
    error --> idle: RESET / clear
`;

/** The proposal's `square` example: an event with payload and two candidates in source order. */
export const squareFixture: VizFixture<SquareContext> = {
    name: "square",
    source,
    config: {
        id: "square",
        source,
        initial: "idle",
        states: {
            idle: {
                on: {
                    SQUARE: [
                        { target: "done", guard: "isFinite", actions: ["square"] },
                        { target: "error", actions: ["reject"] },
                    ],
                },
            },
            done: { on: { RESET: { target: "idle", actions: ["clear"] } } },
            error: { on: { RESET: { target: "idle", actions: ["clear"] } } },
        },
    },
    context: { result: null, error: null },
    guards: {
        isFinite: ({ event }) => Number.isFinite(event.value),
    },
    actions: {
        square: ({ event }) => ({ result: (event.value as number) ** 2, error: null }),
        reject: ({ context }) => ({ ...context, error: "not a finite number" }),
        clear: () => ({ result: null, error: null }),
    },
};
