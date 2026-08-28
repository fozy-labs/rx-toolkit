/**
 * Round-trip fixtures: machines authored as library configs (implementation
 * names as strings, `type: "final"` for `$final`, `#id.path` targets across
 * scopes) in the parser's canonical JSON form — a bare target when there is
 * no guard / action, an array only for several candidates, objects inside
 * `after` / `onDone` arrays. `parse(withDirectives(toMermaid()))` must give
 * back `id` / `initial` / `states` as written here. Shared by
 * `roundTrip.test.ts` (parse) and `typecheck.test.ts` (convert + tsc).
 */
import {
    mutate,
    type AnyEventObject,
    type MachineConfig,
    type MachineContext,
    type MachineImplementations,
} from "@fozy-labs/rx-toolkit";

export interface RoundTripFixture {
    name: string;
    /** `@context type` text for the generated file; absent when the config has no context. */
    contextType?: string;
    config: MachineConfig<MachineContext, AnyEventObject>;
    implementations?: MachineImplementations<MachineContext, AnyEventObject>;
}

/** The proposal's `trafficLight` (config of `src/statechart/__tests__/proposal/trafficLight.generated.ts`). */
export const trafficLight: RoundTripFixture = {
    name: "trafficLight",
    contextType: "{ power: boolean; retries: number }",
    config: {
        id: "trafficLight",
        context: { power: true, retries: 0 },
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
    implementations: {
        guards: { hasPower: ({ context }) => context.power },
        actions: {
            logStart: () => {},
            retry: mutate(({ context }) => {
                context.retries += 1;
            }),
            warn: () => {},
        },
    },
};

/** The proposal's `square` (config of `src/statechart/__tests__/proposal/square.generated.ts`). */
export const square: RoundTripFixture = {
    name: "square",
    contextType: "{ result: number | null; error: string | null }",
    config: {
        id: "square",
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
    implementations: {
        guards: { isFinite: ({ event }) => typeof event.value === "number" && Number.isFinite(event.value) },
        actions: {
            square: mutate(({ context, event }) => {
                context.result = typeof event.value === "number" ? event.value ** 2 : null;
                context.error = null;
            }),
            reject: mutate(({ context }) => {
                context.error = "not a finite number";
            }),
            clear: mutate(({ context }) => {
                context.result = null;
                context.error = null;
            }),
        },
    },
};

/** Parallel node with `$0` / `$1` regions, a `$final` in each, `onDone`, and cross-scope targets in both directions. */
export const player: RoundTripFixture = {
    name: "player",
    config: {
        id: "player",
        initial: "idle",
        states: {
            idle: { on: { PLAY: "running", JUMP: "#player.running.$0.loud" } },
            running: {
                type: "parallel",
                onDone: "idle",
                on: { STOP: "idle" },
                states: {
                    $0: {
                        initial: "quiet",
                        states: {
                            quiet: { on: { LOUDER: "loud" } },
                            loud: { on: { QUIETER: "quiet", MUTE: "$final" } },
                            $final: { type: "final" },
                        },
                    },
                    $1: {
                        initial: "playing",
                        states: {
                            playing: { on: { PAUSE: "paused", END: "$final" } },
                            paused: { on: { PAUSE: "playing", QUIT: "#player.idle" } },
                            $final: { type: "final" },
                        },
                    },
                },
            },
        },
    },
};

/** A choice: an atomic state whose transitions are `always` candidates, guarded ones first, the unguarded one last. */
export const gate: RoundTripFixture = {
    name: "gate",
    contextType: "{ n: number }",
    config: {
        id: "gate",
        context: { n: 0 },
        initial: "check",
        states: {
            check: { always: [{ target: "big", guard: "isBig" }, { target: "small", guard: "isSmall" }, "zero"] },
            big: { on: { RESET: "check" } },
            small: { on: { RESET: "check" } },
            zero: { on: { RESET: "check" } },
        },
    },
    implementations: {
        guards: { isBig: ({ context }) => context.n > 10, isSmall: ({ context }) => context.n > 0 },
    },
};

/** `after` with a named delay and with two candidates for one delay (objects inside the array). */
export const timer: RoundTripFixture = {
    name: "timer",
    contextType: "{ ticks: number }",
    config: {
        id: "timer",
        context: { ticks: 0 },
        initial: "waiting",
        states: {
            waiting: {
                after: {
                    slow: { target: "fired", actions: ["tick"] },
                    2000: [{ target: "fired", guard: "ready" }, { target: "stalled" }],
                },
            },
            fired: { on: { RESET: "waiting" } },
            stalled: { on: { RESET: "waiting" } },
        },
    },
    implementations: {
        guards: { ready: ({ context }) => context.ticks > 0 },
        actions: {
            tick: mutate(({ context }) => {
                context.ticks += 1;
            }),
        },
        delays: { slow: 500 },
    },
};

/** Three candidates for one event (two guarded), a described state and the root's `$final`. */
export const router: RoundTripFixture = {
    name: "router",
    contextType: "{ role: string }",
    config: {
        id: "router",
        context: { role: "guest" },
        initial: "home",
        states: {
            home: {
                on: {
                    OPEN: [
                        { target: "admin", guard: "isAdmin" },
                        { target: "member", guard: "isMember", actions: ["log"] },
                        "public",
                    ],
                    QUIT: "$final",
                },
            },
            admin: { on: { BACK: "home" } },
            member: { on: { BACK: "home" } },
            public: { description: "Public area", on: { BACK: "home" } },
            $final: { type: "final" },
        },
    },
    implementations: {
        guards: {
            isAdmin: ({ context }) => context.role === "admin",
            isMember: ({ context }) => context.role === "member",
        },
        actions: { log: () => {} },
    },
};

export const roundTripFixtures: readonly RoundTripFixture[] = [trafficLight, square, player, gate, timer, router];

/**
 * `toMermaid()` cannot restore bodies, so the round trip supplies them: one
 * directive per implementation name of the fixture (`@guard NAME: true`,
 * `@action NAME: void 0`, `@delay NAME: 0`) and the `@context type`, inserted
 * right after the `stateDiagram-v2` header.
 */
export function withDirectives(mermaid: string, fixture: RoundTripFixture): string {
    const lines = mermaid.split("\n");
    if (lines[0] !== "stateDiagram-v2") throw new Error(`expected the header on the first line, got ${lines[0]}`);
    const { guards = {}, actions = {}, delays = {} } = fixture.implementations ?? {};
    const directives = [
        ...(fixture.contextType === undefined ? [] : [`%% @context type: ${fixture.contextType}`]),
        ...Object.keys(guards).map((name) => `%% @guard ${name}: true`),
        ...Object.keys(actions).map((name) => `%% @action ${name}: void 0`),
        ...Object.keys(delays).map((name) => `%% @delay ${name}: 0`),
    ];
    return [lines[0], ...directives.map((line) => `    ${line}`), ...lines.slice(1)].join("\n");
}

/** Every state path of a config (regions included, `$final` excluded), depth first in config order. */
export function statePathsOf(states: Record<string, { states?: Record<string, unknown> }>, prefix = ""): string[] {
    const paths: string[] = [];
    for (const [key, node] of Object.entries(states)) {
        if (key === "$final") continue;
        const path = prefix === "" ? key : `${prefix}.${key}`;
        paths.push(path);
        if (node.states !== undefined) {
            paths.push(...statePathsOf(node.states as Record<string, { states?: Record<string, unknown> }>, path));
        }
    }
    return paths;
}
