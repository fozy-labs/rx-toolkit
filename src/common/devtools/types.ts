export interface DevtoolsStateLike<T = any> {
    (newState: T, actionName?: string): void;
}
export interface DevtoolsLike {
    state<T>(name: string, initState: T): DevtoolsStateLike<T>;
}

// --- statechart inspection -------------------------------------------------
// Structural mirrors of the statechart types, kept dependency-free so that
// `common` never imports from `statechart`.

export interface MachineDevtoolsEvent {
    readonly type: string;
}

export interface MachineDevtoolsSnapshot {
    readonly status: "active" | "done" | "error" | "stopped";
    readonly value: unknown;
    readonly context: unknown;
    readonly output?: unknown;
    readonly error?: unknown;
    readonly tags?: readonly string[];
}

export interface MachineDevtoolsActorInfo {
    /**
     * Unique per `Statechart` instance (the engine passes `"sc:<n>"`). When
     * omitted the adapter generates one (`crypto.randomUUID` with a fallback).
     */
    readonly sessionId?: string;
    /** Display name: the machine id. */
    readonly name: string;
    /** The raw machine config; functions are serialized as `{ type: fn.name }`. */
    readonly definition: unknown;
    /** Snapshot at registration time (initial state). */
    readonly snapshot: MachineDevtoolsSnapshot;
}

/** Per-instance handle returned by `MachineDevtoolsLike.actor()`. */
export interface MachineDevtoolsActor {
    /** An event was received by the machine (before the macrostep). */
    event(event: MachineDevtoolsEvent): void;
    /** A macrostep for `event` finished with `snapshot` (sent even when unchanged). */
    snapshot(snapshot: MachineDevtoolsSnapshot, event: MachineDevtoolsEvent): void;
    /** The instance was disposed; release anything held for it. */
    stop(): void;
}

/**
 * Inspector hook for statecharts (Stately Inspector and the like). Distinct
 * from `DevtoolsLike`, which models named state values; `combineDevtools`
 * is unaffected. Default instance: `SharedOptions.MACHINE_DEVTOOLS`.
 */
export interface MachineDevtoolsLike {
    actor(info: MachineDevtoolsActorInfo): MachineDevtoolsActor;
}
