import type { MachineDevtoolsLike } from "@/common/devtools/types";
import type { DisposableSignal } from "@/signals/types";

import type { MachineDefinition } from "../MachineDefinition";

import type { MachineContext } from "./common";
import type { EventObject } from "./events";
import type { MachineSnapshot, StateValue } from "./stateValue";

/** Timer source used for `after` transitions and delayed `raise`. Defaults to `globalThis`. */
export interface MachineClock {
    setTimeout(callback: () => void, delay: number): unknown;
    clearTimeout(handle: unknown): void;
}

export type MachineLogger = (...args: unknown[]) => void;

export interface StatechartOptions {
    /**
     * Redux DevTools key, resolved exactly like `SignalOptions.key` with
     * `base: "Statechart"`: the key is used verbatim, a `{base}` placeholder
     * becomes `Statechart`, `{scope}` becomes the current scope name.
     *
     * Without a key the entry is `Statechart/<machine id>` for the first live
     * instance of a definition; while it is alive, further keyless instances
     * of the same machine id get `Statechart/<machine id>#2`, `#3`, ... (the
     * lowest free number, released by `dispose()`), so concurrent instances
     * never share one entry. Pass a key for a stable, meaningful name.
     */
    key?: string;
    /** Disables Redux DevTools for this instance. */
    isDisabled?: boolean;
    /** Stately Inspector adapter; `null` disables. @default SharedOptions.MACHINE_DEVTOOLS */
    inspector?: MachineDevtoolsLike | null;
    /**
     * Call `start()` from the constructor. The initial macrostep is always
     * computed in the constructor (its effects are deferred); with `false`
     * events are queued and the initial snapshot / effects are committed on the
     * first `start()`.
     * @default true
     */
    autoStart?: boolean;
    clock?: MachineClock;
    /** Receives runtime errors instead of them being rethrown from `send()` / `start()`. */
    onError?: (error: unknown) => void;
    /** Sink of the `log()` builtin. @default console.log */
    logger?: MachineLogger;
    /** Guard against runaway `always` / `raise` cycles within one macrostep. @default 10000 */
    maxMicrosteps?: number;
}

/** `StatechartOptions` or just the Redux DevTools key (like `SignalOptionsOrKey`). */
export type StatechartOptionsOrKey = StatechartOptions | string;

export type StatechartStatus = "idle" | "running" | "stopped" | "disposed";

/**
 * The callable signal returned by `MachineSignal.state()`: a disposable
 * read-only signal of the snapshot enriched with the machine API.
 */
export interface MachineStateSignal<
    TContext extends MachineContext,
    TEvent extends EventObject,
    TOutput = unknown,
> extends DisposableSignal<MachineSnapshot<TContext, TOutput>> {
    readonly definition: MachineDefinition<TContext, TEvent, TOutput>;
    /** Engine lifecycle (`idle` before `start()`), distinct from the snapshot `status`. */
    readonly status: StatechartStatus;
    send(event: TEvent): void;
    /** XState `matches()` semantics: string paths (`"a.b"`) or nested objects. */
    matches(stateValue: StateValue): boolean;
    /** Whether `event` would select at least one non-forbidden transition on the current snapshot. */
    can(event: TEvent): boolean;
    start(): void;
    stop(): void;
}
