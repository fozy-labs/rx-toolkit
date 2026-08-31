import type { MachineDevtoolsActor, MachineDevtoolsLike } from "@/common/devtools/types";
import { SharedOptions } from "@/common/options/SharedOptions";
import { Batcher } from "@/signals/base/Batcher";
import { SYMBOL_DISPOSE } from "@/signals/base/disposeSymbol";
import { State } from "@/signals/signals/State";
import type { ReadonlySignal } from "@/signals/types";

import { createInitEvent, createStopEvent, DEFAULT_MAX_MICROSTEPS, XSTATE_STOP } from "./core/constants";
import {
    canHandle,
    createSnapshot,
    initialize,
    step,
    type ActionExecutor,
    type InterpreterScope,
    type ScheduleRequest,
} from "./core/interpreter";
import type { MachineModel, MachineState } from "./core/model";
import { matchesState } from "./core/stateValue";
import { assertImplementations, getMachineModel, type MachineDefinition } from "./MachineDefinition";
import type {
    EventObject,
    MachineClock,
    MachineContext,
    MachineEvent,
    MachineLogger,
    MachineSnapshot,
    StatechartOptions,
    StatechartOptionsOrKey,
    StatechartStatus,
    StateValue,
} from "./types";

/** Redux DevTools base of every machine signal (`Devtools.createKey(key, base)`). */
const DEVTOOLS_BASE = "Statechart";

let sessionCounter = 0;

/**
 * Timer bookkeeping entry. The callback compares identities before deleting
 * so that a clock firing synchronously (or a stale callback of a replaced
 * timer) never removes a newer entry registered under the same key.
 */
interface TimerEntry {
    handle: unknown;
}

const DEFAULT_CLOCK: MachineClock = {
    // Resolved at call time so that fake timers installed later (tests) are honoured.
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

const DEFAULT_LOGGER: MachineLogger = (...args) => console.log(...args);

interface ResolvedStatechartOptions {
    /** `null` = no key given: a per-instance default is allocated (`acquireDefaultKeySlot`). */
    readonly key: string | null;
    readonly isDisabled: boolean | undefined;
    /** `null` = off; resolved against `SharedOptions.MACHINE_DEVTOOLS` at construction time. */
    readonly inspector: MachineDevtoolsLike | null;
    readonly autoStart: boolean;
    readonly clock: MachineClock;
    readonly onError: ((error: unknown) => void) | undefined;
    readonly logger: MachineLogger;
    readonly maxMicrosteps: number;
}

function resolveOptions(options: StatechartOptionsOrKey | undefined): ResolvedStatechartOptions {
    const raw: StatechartOptions = typeof options === "string" ? { key: options } : (options ?? {});
    return {
        key: raw.key ?? null,
        isDisabled: raw.isDisabled,
        inspector: raw.inspector === undefined ? SharedOptions.MACHINE_DEVTOOLS : raw.inspector,
        autoStart: raw.autoStart ?? true,
        clock: raw.clock ?? DEFAULT_CLOCK,
        onError: raw.onError,
        logger: raw.logger ?? DEFAULT_LOGGER,
        maxMicrosteps: raw.maxMicrosteps ?? DEFAULT_MAX_MICROSTEPS,
    };
}

// --- default Redux DevTools keys ---------------------------------------------

/**
 * Ordinal slots of the live keyless instances of each machine id. Slot 1
 * renders as `{base}/<id>`, slot n as `{base}/<id>#n`; the lowest free slot
 * is taken and released again on `dispose()` (or by the finalizer). So
 * concurrent keyless instances of one definition never fight over a single
 * Redux DevTools entry, while a re-created instance (React re-mount,
 * StrictMode) gets its predecessor's name back.
 */
const defaultKeySlots = new Map<string, Set<number>>();

interface DefaultKeySlot {
    readonly machineId: string;
    readonly slot: number;
}

function acquireDefaultKeySlot(machineId: string): DefaultKeySlot {
    let taken = defaultKeySlots.get(machineId);
    if (taken === undefined) {
        taken = new Set();
        defaultKeySlots.set(machineId, taken);
    }
    let slot = 1;
    while (taken.has(slot)) slot += 1;
    taken.add(slot);
    return { machineId, slot };
}

function releaseDefaultKeySlot({ machineId, slot }: DefaultKeySlot): void {
    const taken = defaultKeySlots.get(machineId);
    if (taken === undefined) return;
    taken.delete(slot);
    if (taken.size === 0) defaultKeySlots.delete(machineId);
}

function formatDefaultKey({ machineId, slot }: DefaultKeySlot): string {
    return slot === 1 ? `{base}/${machineId}` : `{base}/${machineId}#${slot}`;
}

// --- inspector ---------------------------------------------------------------

function reportInspectorFailure(error: unknown): void {
    if (typeof console === "undefined" || typeof console.error !== "function") return;
    console.error(
        "[RxToolkit Statechart] the inspector adapter threw; the inspector is disabled for this instance",
        error,
    );
}

/** What the finalizer releases for an engine that was garbage-collected without `dispose()`. */
interface FinalizationTarget {
    readonly actorHandle: MachineDevtoolsActor | null;
    readonly keySlot: DefaultKeySlot | null;
}

/**
 * Runtime engine of one machine instance: snapshot signal (`State` with Redux
 * DevTools wiring), event queue, timers (`after` / delayed `raise`), Stately
 * Inspector wiring and error handling. The pure step algorithm lives in
 * `core/interpreter.ts`; this class only sequences it. Spec: section 4.
 *
 * Prefer the facade `unstable_MachineSignal.state(definition, options)`; use
 * this class directly for advanced composition.
 */
export class unstable_Statechart<
    TContext extends MachineContext = MachineContext,
    TEvent extends EventObject = EventObject,
    TOutput = unknown,
> implements Disposable {
    readonly definition: MachineDefinition<TContext, TEvent, TOutput>;
    /** Tracked/untracked reads of the current snapshot; pushes once per macrostep. */
    readonly state: ReadonlySignal<MachineSnapshot<TContext, TOutput>>;
    /** Unique per instance (`"sc:<n>"`); used as the inspector session id. */
    readonly sessionId: string;

    private readonly _model: MachineModel<TContext, TEvent>;
    private readonly _scope: InterpreterScope<TContext, TEvent>;
    private readonly _options: ResolvedStatechartOptions;
    private readonly _state$: State<MachineSnapshot<TContext, TOutput>>;
    /** Allocated only for keyless instances; released by `dispose()` / the finalizer. */
    private readonly _keySlot: DefaultKeySlot | null;
    /** Best-effort: set to `null` after the adapter threw once (`_notifyInspector`). */
    private _actorHandle: MachineDevtoolsActor | null;

    private _machineState: MachineState<TContext, TEvent>;
    private _snapshot: MachineSnapshot<TContext, TOutput>;
    private _status: StatechartStatus = "idle";

    /** Re-entrancy guard: true while a burst (a macrostep or `start()`, plus everything it triggers) runs; nested sends are queued. */
    private _processing = false;
    private _disposeRequested = false;
    private _restartRequested = false;
    /** Error raised inside the guarded section, reported once the batch has finished. */
    private _failure: { error: unknown } | null = null;
    /** Events sent before `start()` and re-entrant sends (FIFO). */
    private readonly _queue: MachineEvent<TEvent>[] = [];
    /** Executor calls captured while not running (initial actions), flushed by `start()`. */
    private readonly _deferred: (() => void)[] = [];
    private readonly _timers = new Map<string, TimerEntry>();
    private _timerSequence = 0;

    /** `options` may be just the Redux DevTools key, like `Signal.state(value, "key")`. */
    constructor(definition: MachineDefinition<TContext, TEvent, TOutput>, options?: StatechartOptionsOrKey) {
        this.definition = definition;
        this.sessionId = `sc:${++sessionCounter}`;
        this._model = getMachineModel(definition);
        this._options = resolveOptions(options);

        // Lazy implementation check: every action / guard / delay name the
        // config references must exist by now (`provide()` may have added it).
        assertImplementations(definition);

        this._scope = {
            implementations: definition.implementations,
            executor: this._createExecutor(),
            maxMicrosteps: this._options.maxMicrosteps,
        };

        // The initial macrostep runs eagerly (effects deferred until `start()`),
        // so the snapshot signal is meaningful before the engine is started.
        const initialization = this._computeInitialState();
        this._machineState = initialization.state;
        this._snapshot = createSnapshot<TContext, TEvent, TOutput>(this._model, this._machineState);

        // Everything below allocates resources that `dispose()` releases; the
        // catch at the end covers a constructor that throws after this point.
        let key = this._options.key;
        let keySlot: DefaultKeySlot | null = null;
        if (key === null) {
            keySlot = acquireDefaultKeySlot(definition.id);
            key = formatDefaultKey(keySlot);
        }
        this._keySlot = keySlot;
        this._state$ = new State<MachineSnapshot<TContext, TOutput>>(this._snapshot, {
            key,
            base: DEVTOOLS_BASE,
            isDisabled: this._options.isDisabled,
        });
        this.state = unstable_Statechart._createReadonlySignal(this._state$);

        this._actorHandle = this._createActorHandle();
        if (this._actorHandle !== null || this._keySlot !== null) {
            const target: FinalizationTarget = { actorHandle: this._actorHandle, keySlot: this._keySlot };
            unstable_Statechart._finalizationRegistry.register(this, target, this);
        }

        // Nobody can call `dispose()` on an instance whose constructor threw:
        // release the signal (DevTools entry) and the inspector actor first.
        try {
            if (initialization.error) {
                this._haltAfterFailure(initialization.error.error);
            } else if (this._options.autoStart) {
                this.start();
            }
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    /** `"idle"` before `start()`, `"running"`, `"stopped"` after `stop()` / done / error, `"disposed"`. */
    get status(): StatechartStatus {
        return this._status;
    }

    /**
     * Commits the initial snapshot and flushes its deferred effects (or
     * re-initializes a stopped/done/errored machine). Moves straight to
     * `stopped` when the initial snapshot is already done/error. Throws after
     * `dispose()`. Called from inside a burst (an action, a synchronous
     * subscriber or an effect reacting to the done / error / stop snapshot)
     * the restart is deferred until the burst has finished.
     */
    start(): void {
        if (this._status === "disposed") throw new Error("Statechart has been disposed");
        if (this._status === "running") return;
        if (this._processing) {
            // Only reachable once the burst in progress stopped the engine;
            // `_runGuarded` performs the restart after the batch (and after
            // the error report, if the burst failed).
            this._restartRequested = true;
            return;
        }

        let initError: { error: unknown } | null = null;
        if (this._status === "stopped") {
            // Restart from scratch: fresh context, fresh initial macrostep (effects deferred).
            this._deferred.length = 0;
            this._queue.length = 0;
            const initialization = this._computeInitialState();
            this._setMachineState(initialization.state);
            initError = initialization.error;
        }

        this._runGuarded(() => {
            this._status = "running";
            const initEvent = createInitEvent();
            this._notifyInspector((handle) => handle.event(initEvent));

            if (initError) {
                // Re-initialization failed inside a builtin (initial `assign`,
                // `always` guard, delay resolver): commit the error snapshot.
                this._halt();
                this._commit(initEvent);
                this._failure = initError;
                return;
            }

            this._commit(initEvent);

            // Initial effects run only now, after the snapshot is visible —
            // XState `update()` flushes `_deferred` before the mailbox starts.
            let effect: (() => void) | undefined;
            while ((effect = this._deferred.shift())) {
                try {
                    effect();
                } catch (error) {
                    this._deferred.length = 0;
                    this._fail(error, this._machineState, initEvent);
                    return;
                }
            }

            if (this._machineState.status !== "active") {
                // Done at initialization: nothing will ever be processed.
                this._halt();
                return;
            }
            this._drain();
        });
    }

    /**
     * Processes `xstate.stop`, cancels timers and drops queued events. No-op
     * unless running; called from inside a burst (an action, a subscriber or
     * an effect) it is deferred to the end of the current macrostep (XState
     * behaviour).
     */
    stop(): void {
        if (this._status !== "running") return;
        this._queue.length = 0;
        const stopEvent = createStopEvent();
        if (this._processing) {
            // Never step inside a running step: the outer `process()` would
            // overwrite the state. The drain loop picks the stop event up.
            this._queue.push(stopEvent);
            return;
        }
        this._runGuarded(() => {
            this._process(stopEvent);
        });
    }

    /**
     * Synchronous: a full macrostep inside `Batcher.run`, one snapshot push.
     * Re-entrant calls (from actions, subscribers and effects) and events sent
     * before `start()` are queued; events after done/error/stop/dispose are
     * ignored.
     */
    send(event: TEvent): void {
        if (typeof event !== "object" || event === null || typeof event.type !== "string") {
            throw new TypeError("Statechart.send(): event must be an object with a string 'type'");
        }
        switch (this._status) {
            case "idle":
                this._queue.push(event);
                return;
            case "running":
                this._receive(event);
                return;
            default:
                // stopped / disposed: ignored silently (the snapshot status tells why).
                return;
        }
    }

    matches(stateValue: StateValue): boolean {
        return matchesState(stateValue, this._snapshot.value);
    }

    /** Pure query on the current snapshot (XState `snapshot.can`), independent of the engine status; `false` once disposed. */
    can(event: TEvent): boolean {
        if (this._status === "disposed") return false;
        return canHandle(this._model, this._machineState, event, this._scope);
    }

    /** Alias of `state.peek()`. */
    getSnapshot(): MachineSnapshot<TContext, TOutput> {
        return this._state$.peek();
    }

    /**
     * Stops if running, completes the signal (drops the DevTools entry),
     * releases the inspector actor. Idempotent; called from inside a burst it
     * finishes after the current macrostep.
     */
    dispose(): void {
        if (this._status === "disposed") return;
        if (this._processing) {
            if (!this._disposeRequested) {
                this._disposeRequested = true;
                this.stop();
            }
            return;
        }
        if (this._status === "running") this.stop();
        this._finishDispose();
    }

    [SYMBOL_DISPOSE](): void {
        this.dispose();
    }

    // === initialization ===

    /**
     * Runs the initial macrostep with the executor in deferred mode. A throw
     * (builtin at init) yields an error state built from the pre-initial
     * state; the caller decides where to report it.
     */
    private _computeInitialState(): { state: MachineState<TContext, TEvent>; error: { error: unknown } | null } {
        try {
            return { state: initialize(this._model, this._scope).state, error: null };
        } catch (error) {
            this._deferred.length = 0;
            return { state: this._createErrorState(this._createPreInitialState(), error), error: { error } };
        }
    }

    /**
     * The state before the initial transition, used as the base of an
     * init-time error snapshot. A `context` factory is not invoked again (it
     * may be the very thing that threw, and it may have side effects); an
     * object context is the shared object anyway.
     */
    private _createPreInitialState(): MachineState<TContext, TEvent> {
        const configContext = this._model.config.context;
        const context = (typeof configContext === "function" ? {} : (configContext ?? {})) as TContext;
        return {
            configuration: new Set([this._model.root]),
            context,
            historyValue: Object.freeze({}),
            status: "active",
            output: undefined,
            error: undefined,
        };
    }

    private _createErrorState(base: MachineState<TContext, TEvent>, error: unknown): MachineState<TContext, TEvent> {
        return { ...base, status: "error", output: undefined, error };
    }

    // === guarded processing ===

    /**
     * The single re-entrancy-guarded section: `Batcher.run` around the burst
     * (a macrostep plus every re-entrant send), `processing` set so that
     * nested `send()` / `stop()` / `dispose()` / `start()` calls are queued or
     * deferred, deferred teardown / restart in the tail, and the failure (if
     * any) reported only after the batch has flushed — throwing out of
     * `Batcher.run` would drop the scheduled derived updates.
     *
     * `Batcher.run` flushes the scheduled Computed/Effect work after the body
     * returned; an effect reacting to the new snapshot may itself `send()`
     * (queued, because the guard is still set). Those events are drained in
     * further rounds — each one a `Batcher.run` of its own, so its effects are
     * flushed too — until nothing new arrives.
     */
    private _runGuarded(body: () => void): void {
        this._processing = true;
        let failure: { error: unknown } | null = null;
        let restart = false;
        try {
            Batcher.run(body);
            while (this._queue.length > 0 && this._status === "running") {
                Batcher.run(() => this._drain());
            }
        } finally {
            failure = this._failure;
            this._failure = null;
            restart = this._restartRequested;
            this._restartRequested = false;
            this._processing = false;
            if (this._disposeRequested) {
                this._disposeRequested = false;
                restart = false;
                this.dispose();
            }
        }
        // An unhandled failure is rethrown here and drops a pending restart:
        // the engine stays in its error state, consistent with the exception.
        if (failure) this._report(failure.error);
        if (restart && this._status === "stopped") this.start();
    }

    /** Entry point of every event while running: direct processing or FIFO when re-entrant. */
    private _receive(event: MachineEvent<TEvent>): void {
        if (this._processing) {
            this._queue.push(event);
            return;
        }
        this._runGuarded(() => {
            this._process(event);
            this._drain();
        });
    }

    private _drain(): void {
        while (this._queue.length > 0 && this._status === "running") {
            this._process(this._queue.shift()!);
        }
    }

    /** One macrostep: inspector event, `step`, halt when finished, commit (when changed), inspector snapshot. */
    private _process(event: MachineEvent<TEvent>): void {
        // XState enqueues `xstate.stop` straight into the mailbox (no `@xstate.event`).
        if (event.type !== XSTATE_STOP) this._notifyInspector((handle) => handle.event(event));

        let next: MachineState<TContext, TEvent>;
        try {
            next = step(this._model, this._machineState, event, this._scope).state;
        } catch (error) {
            this._fail(error, this._machineState, event);
            return;
        }

        if (next !== this._machineState) this._setMachineState(next);
        // Engine invariants (timers, queue, status) are settled before anything
        // external — subscribers, effects, the inspector — observes the snapshot.
        if (this._machineState.status !== "active") this._halt();
        this._commit(event);
    }

    /** Keeps `_snapshot` in sync with `_machineState`: a new snapshot object only when the state changed. */
    private _setMachineState(state: MachineState<TContext, TEvent>): void {
        this._machineState = state;
        this._snapshot = createSnapshot<TContext, TEvent, TOutput>(this._model, state);
    }

    /**
     * Pushes the current snapshot (actionName = event type) and notifies the
     * inspector. `State.set` dedupes by identity, so an unchanged macrostep
     * (and the initial commit of `start()`) costs no emission; the inspector
     * is told about every macrostep regardless.
     */
    private _commit(event: EventObject): void {
        this._state$.set(this._snapshot, event.type);
        this._notifyInspector((handle) => handle.snapshot(this._snapshot, event));
    }

    /** Error policy (spec 4.5): error snapshot on top of the last good state, halt, report after the batch. */
    private _fail(error: unknown, base: MachineState<TContext, TEvent>, event: EventObject): void {
        this._setMachineState(this._createErrorState(base, error));
        this._halt();
        this._commit(event);
        this._failure = { error };
    }

    /** Constructor-time init failure: the error snapshot is already the initial value; no macrostep to commit. */
    private _haltAfterFailure(error: unknown): void {
        this._halt();
        this._report(error);
    }

    /** The machine is finished (done / error / stopped): no timers, no pending events, engine stopped. */
    private _halt(): void {
        this._cancelAllTimers();
        this._queue.length = 0;
        this._deferred.length = 0;
        this._status = "stopped";
    }

    private _report(error: unknown): void {
        if (this._options.onError) {
            this._options.onError(error);
        } else {
            throw error;
        }
    }

    private _finishDispose(): void {
        this._cancelAllTimers();
        this._queue.length = 0;
        this._deferred.length = 0;
        this._status = "disposed";
        unstable_Statechart._finalizationRegistry.unregister(this);
        this._state$.dispose();
        if (this._keySlot !== null) releaseDefaultKeySlot(this._keySlot);
        this._notifyInspector((handle) => handle.stop());
        this._actorHandle = null;
    }

    // === inspector ===

    private _createActorHandle(): MachineDevtoolsActor | null {
        const inspector = this._options.inspector;
        if (inspector === null) return null;
        try {
            return (
                inspector.actor({
                    sessionId: this.sessionId,
                    name: this.definition.id,
                    definition: this.definition.config,
                    snapshot: this._snapshot,
                }) ?? null
            );
        } catch (error) {
            reportInspectorFailure(error);
            return null;
        }
    }

    /**
     * The inspector is best-effort: an adapter that throws must break neither
     * the engine's invariants (halt, queue, timers) nor the batch. The first
     * failure is logged and disables the handle for this instance.
     */
    private _notifyInspector(notify: (handle: MachineDevtoolsActor) => void): void {
        const handle = this._actorHandle;
        if (handle === null) return;
        try {
            notify(handle);
        } catch (error) {
            this._actorHandle = null;
            reportInspectorFailure(error);
        }
    }

    // === executor / timers ===

    private _createExecutor(): ActionExecutor<TContext, TEvent> {
        return {
            custom: (action) => this._effect(() => action.exec(action.args, action.params)),
            schedule: (request) => this._effect(() => this._scheduleTimer(request)),
            cancel: (id) => this._effect(() => this._cancelTimer(id)),
            log: (value, label) =>
                this._effect(() => {
                    if (label === undefined) this._options.logger(value);
                    else this._options.logger(label, value);
                }),
        };
    }

    /** Deferred while not running (initial macrostep), synchronous inside a running macrostep. */
    private _effect(fn: () => void): void {
        if (this._status === "running") fn();
        else this._deferred.push(fn);
    }

    private _scheduleTimer(request: ScheduleRequest<TEvent>): void {
        const key = request.id ?? `@@timer:${++this._timerSequence}`;
        // Deliberate deviation (spec 11.11): a pending timer under the same id is replaced.
        this._cancelTimer(key);
        const entry: TimerEntry = { handle: undefined };
        this._timers.set(key, entry);
        entry.handle = this._options.clock.setTimeout(() => {
            // Only the entry still registered under its key may deliver: the
            // callback of a cancelled or replaced timer that fires anyway
            // (misbehaving clock, also after a stop/start) is ignored — it
            // belongs to a state the engine has left.
            if (this._timers.get(key) !== entry) return;
            this._timers.delete(key);
            if (this._status !== "running") return;
            this._receive(request.event);
        }, request.delay);
    }

    private _cancelTimer(id: string): void {
        const entry = this._timers.get(id);
        if (!entry) return;
        this._timers.delete(id);
        this._options.clock.clearTimeout(entry.handle);
    }

    private _cancelAllTimers(): void {
        for (const [id] of this._timers) this._cancelTimer(id);
    }

    // === static ===

    /** Releases the inspector actor and the default key slot of an engine that was garbage-collected without `dispose()`. */
    private static _finalizationRegistry = new FinalizationRegistry((target: FinalizationTarget) => {
        if (target.keySlot !== null) releaseDefaultKeySlot(target.keySlot);
        if (target.actorHandle !== null) {
            try {
                target.actorHandle.stop();
            } catch (error) {
                reportInspectorFailure(error);
            }
        }
    });

    /** Callable read-only view of the internal `State`: never exposes `set` / `update`. */
    private static _createReadonlySignal<T>(state: State<T>): ReadonlySignal<T> {
        function signalFn() {
            return state.get();
        }
        signalFn.get = () => state.get();
        signalFn.peek = () => state.peek();
        signalFn.obs = state.obs;
        return signalFn;
    }
}
