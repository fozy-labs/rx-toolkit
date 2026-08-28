// AUTO-GENERATED from square.mmd — do not edit
//
// Typed by hand from the proposal (section «Пример: возведение в квадрат»),
// following the shape of `trafficLight.generated.ts`; the only change is the
// import path (`@/index` is this repository's `@fozy-labs/rx-toolkit`).
import { createMachine, mutate, type ActionArgs, type GuardArgs } from "@/index";

export type Context = { result: number | null; error: string | null };

export type Events = { type: "SQUARE"; value: number } | { type: "RESET" };

export type StateId = "idle" | "done" | "error";

export const source = `stateDiagram-v2
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
`; // verbatim input, consumed by viz

export const definition = createMachine<Context, Events>(
    {
        id: "square",
        source,
        context: { result: null, error: null },
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
    {
        guards: {
            isFinite: ({ event }: GuardArgs<Context, Extract<Events, { type: "SQUARE" }>>) =>
                Number.isFinite(event.value),
        },
        actions: {
            square: mutate(({ context, event }: ActionArgs<Context, Extract<Events, { type: "SQUARE" }>>) => {
                context.result = event.value ** 2;
                context.error = null;
            }),
            reject: mutate(({ context }: ActionArgs<Context, Extract<Events, { type: "SQUARE" }>>) => {
                context.error = "not a finite number";
            }),
            clear: mutate(({ context }: ActionArgs<Context, Extract<Events, { type: "RESET" }>>) => {
                context.result = null;
                context.error = null;
            }),
        },
    },
);
