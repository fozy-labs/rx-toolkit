import type { VizFixture } from "./types";

export type TrafficLightContext = { power: boolean; retries: number };

const source = `stateDiagram-v2
    %% @machine trafficLight
    %% @context type: { power: boolean; retries: number }
    %% @context initial: { power: true, retries: 0 }

    [*] --> off

    %% @guard hasPower: context.power
    %% @action logStart: console.log("start")
    off --> working: POWER_ON [hasPower] / logStart
    working --> off: POWER_OFF
    working --> broken: done

    %% @action retry: context.retries += 1
    broken --> off: RESET / retry

    state working {
        [*] --> green
        green --> yellow: after 3000
        %% @action warn: console.warn("yellow -> red")
        yellow --> red: after 1000 / warn
        red --> green: after 3000
        red --> [*]: FAULT
    }
`;

/** The proposal's `trafficLight` example: compound state, delays, `$final` + `onDone`. */
export const trafficLightFixture: VizFixture<TrafficLightContext> = {
    name: "trafficLight",
    source,
    config: {
        id: "trafficLight",
        source,
        initial: "off",
        states: {
            off: { on: { POWER_ON: { target: "working", guard: "hasPower", actions: ["logStart"] } } },
            working: {
                initial: "green",
                on: { POWER_OFF: "off" },
                onDone: "broken",
                states: {
                    green: { after: { 3000: "yellow" } },
                    yellow: { after: { 1000: { target: "red", actions: ["warn"] } } },
                    red: { after: { 3000: "green" }, on: { FAULT: "$final" } },
                    $final: { type: "final" },
                },
            },
            broken: { on: { RESET: { target: "off", actions: ["retry"] } } },
        },
    },
    context: { power: true, retries: 0 },
    guards: {
        hasPower: ({ context }) => context.power,
    },
    actions: {
        logStart: () => undefined,
        warn: () => undefined,
        retry: ({ context }) => ({ ...context, retries: context.retries + 1 }),
    },
};
