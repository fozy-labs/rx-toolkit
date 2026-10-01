import { first, firstValueFrom, Subject, takeUntil, type Unsubscribable } from "rxjs";

import { deepEqual } from "@/common/utils/deepEqual";
import { randomUUID } from "@/common/utils/randomUUID";
import { shallowEqual } from "@/common/utils/shallowEqual";
import { isKeyed } from "@/query/lib/toKeyed";
import type {
    ICommand,
    ICommandClutch,
    IQueryCacheEntry,
    TArgsOrKeyed,
    TBoundCommand,
    TCommandClutchState,
} from "@/query/types";
import { untracked } from "@/signals/base/untracked";
import { Signal } from "@/signals/signals/Signal";
import type { ReadonlySignal, StateSignal } from "@/signals/types";

import type { Issue, SubmitStatus } from "../../types";
import { describeValue } from "../definition/checks";
import type { GroupRecord } from "../definition/records";
import { FormConfigError } from "../FormConfigError";
import type { GroupCore } from "../nodes/GroupCore";
import { derived, nodeKey, ROOT_PATH, writable } from "../nodes/NodeCore";
import { action } from "../runtime/action";
import { guard } from "../runtime/guard";
import { callbackIssue } from "../validation/issues";

import { promiseCommandOf } from "./promiseCommand";
import { toServerIssues } from "./serverIssues";
import { commitSnapshot, layoutServerIssues, type GroupSnapshot } from "./snapshot";

type AnyCommand = ICommand<unknown, unknown, unknown>;
type AnyClutch = ICommandClutch<unknown, unknown, unknown>;
type AnyClutchState = TCommandClutchState<unknown, unknown, unknown>;

/** `preparing`: from the entry into `submit()` to the command; `submitting`: the command runs. */
type Phase = "idle" | "preparing" | "submitting";

/** The outcome of the last finished attempt. */
type Outcome = Exclude<SubmitStatus, "submitting">;

interface SubmitMeta {
    readonly phase: Phase;
    readonly lastOutcome: Outcome;
    readonly submitAttempts: number;
    readonly submitCount: number;
}

/** What identifies the request of an attempt: a later attempt with the same one retries it. */
interface Request {
    readonly command: AnyCommand;
    readonly entryKey: string;
    readonly args: unknown;
}

/** `aborted`: the command entry was removed mid-flight (`resetAll()`, a trigger of the same key elsewhere). */
type Settled =
    | { readonly status: "success" }
    | { readonly status: "error"; readonly error: unknown }
    | { readonly status: "aborted" };

interface Flight {
    readonly settled: Promise<Settled>;
    /** The request to retry if the attempt fails; `null` for a promise submit. */
    readonly request: Request | null;
    /** The base generation when the command started. */
    readonly generation: number;
    /** A promise submit that resolved to a bound command. */
    readonly configError: () => FormConfigError | undefined;
}

/** One run of `submit()`, from the entry to the phase back at idle. */
interface Attempt {
    /** Waits for the queries: a root reset ends the attempt there. */
    waiting: boolean;
    /** A root reset / initialize came after the wait: the result is not applied. */
    superseded: boolean;
    /** Emits when a reset ends the attempt during the wait. */
    readonly ended$: Subject<void>;
}

const IDLE: SubmitMeta = Object.freeze({ phase: "idle", lastOutcome: "idle", submitAttempts: 0, submitCount: 0 });
const NO_ISSUES: Issue[] = [];
const SUCCESS: Settled = Object.freeze({ status: "success" });
const ABORTED: Settled = Object.freeze({ status: "aborted" });
const noop = () => {};
const noConfigError = () => undefined;

/** Runs `fn` as a form action: untracked, one batch. */
const act = <T>(fn: () => T): T => action(fn)();

/**
 * The submit of the root: its phase, the outcome of the last attempt, the counters and the
 * command clutches (one per command, so `submission$` mirrors the one the last attempt used).
 *
 * An attempt: drop the server issues, mark the tree touched and `submitted`; wait for the
 * queries (or refuse on them); stop on `!isValid$`; call the handler and snapshot what it sends;
 * retry the failed request or trigger a new one; on the settle, commit the snapshot or lay the
 * server issues out by it.
 */
export class SubmitController {
    readonly submission$: ReadonlySignal<Omit<AnyClutchState, "retry"> | null>;
    readonly isSubmitting$: ReadonlySignal<boolean>;
    readonly status$: ReadonlySignal<SubmitStatus>;
    readonly submitAttempts$: ReadonlySignal<number>;
    readonly submitCount$: ReadonlySignal<number>;
    readonly canSubmit$: ReadonlySignal<boolean>;
    /** The `callback` issue of a handler that threw: a root issue until the next attempt. */
    readonly issues$: ReadonlySignal<Issue[]>;

    private readonly _meta$: StateSignal<SubmitMeta>;
    private readonly _issues$: StateSignal<Issue[]>;
    /** The clutch `submission$` mirrors; `null` until an attempt reaches a command. */
    private readonly _clutch$: StateSignal<AnyClutch | null>;
    private readonly _clutches = new Map<AnyCommand, AnyClutch>();
    /** The key the form mints for its entries, lazily; dropped to rotate. */
    private _defaultKey: string | undefined;
    /** The key of the entry `submission$` mirrors. */
    private _entryKey: string | undefined;
    /** The request of the last attempt that failed at the command. */
    private _failed: Request | null = null;
    /** The attempt that owns the phase; `null` while it is idle. */
    private _current: Attempt | null = null;

    constructor(
        private readonly _root: GroupCore,
        private readonly _record: GroupRecord,
        private readonly _ctx: object,
    ) {
        const key = nodeKey(_root.scope, _root.segments);
        this._meta$ = writable(`${key}/submit$`, IDLE);
        this._issues$ = writable(`${key}/submitIssues$`, NO_ISSUES);
        this._clutch$ = Signal.state<AnyClutch | null>(null, { isDisabled: true });

        const meta$ = this._meta$;
        this.isSubmitting$ = derived(`${key}/isSubmitting$`, () => meta$().phase !== "idle");
        this.status$ = derived(`${key}/status$`, () => {
            const meta = meta$();
            return meta.phase === "idle" ? meta.lastOutcome : "submitting";
        });
        this.submitAttempts$ = derived(`${key}/submitAttempts$`, () => meta$().submitAttempts);
        this.submitCount$ = derived(`${key}/submitCount$`, () => meta$().submitCount);
        this.canSubmit$ = derived(`${key}/canSubmit$`, () => !this.isSubmitting$());
        this.submission$ = derived(
            `${key}/submission$`,
            () => {
                const clutch = this._clutch$();
                return clutch ? withoutRetry(clutch.state$()) : null;
            },
            shallowEqual,
        );
        this.issues$ = this._issues$;
    }

    get entryKey(): string {
        return this._entryKey ?? this._mintedKey();
    }

    submit(options?: { force?: boolean }): Promise<boolean> {
        const attempt = act(() => {
            const meta = this._meta$.peek();
            this._patch({ submitAttempts: meta.submitAttempts + 1 });
            if (this._current) return null;
            this._patch({ phase: "preparing" });
            return (this._current = { waiting: false, superseded: false, ended$: new Subject<void>() });
        });
        if (!attempt) return Promise.resolve(false);
        const force = options?.force === true;
        return untracked(() => this._attempt(attempt, force)).finally(() => this._toIdle(attempt));
    }

    /**
     * Resets the submit state: `status$ → idle`, a new `entryKey`, `submission$ → null`. An
     * attempt still waiting for the queries ends here, and the phase is idle at once. An attempt
     * past the wait is superseded instead, and the reset waits for its phase to become idle.
     */
    reset(): void {
        this._failed = null;
        const attempt = this._current;
        if (attempt && !attempt.waiting) {
            attempt.superseded = true;
            return;
        }
        if (attempt) {
            this._current = null;
            attempt.ended$.next();
            this._patch({ phase: "idle" });
        }
        this._resetNow();
    }

    // ==================== Attempt ====================

    private async _attempt(attempt: Attempt, force: boolean): Promise<boolean> {
        const root = this._root;
        act(() => {
            root.clearServerIssues();
            this._issues$.set(NO_ISSUES);
            root.markTouched(true);
            root.markSubmitted();
        });

        const policy = this._record.pendingQueries ?? "wait";
        // One subscription for the whole `preparing` phase activates every query of the tree,
        // including the ones nobody looks at.
        const hold = policy === "wait" ? root.isPending$.obs.subscribe({ error: noop }) : null;
        let flight: Flight;
        let snapshot: GroupSnapshot;
        try {
            if (hold) {
                attempt.waiting = true;
                await this._whenNotPending(attempt);
                // Ended by a reset: the phase belongs to no one or to a newer attempt.
                if (this._current !== attempt) return false;
                attempt.waiting = false;
            } else if (policy === "reject" && untracked(() => root.isPending$.peek())) return false;

            if (!untracked(() => root.isValid$.peek())) {
                return act(() => this._finish(attempt, "invalid", false));
            }
            const handler = this._record.submit;
            if (!handler) return act(() => this._finish(attempt, "success", true));

            const outcome = untracked(() => guard(() => handler(this._ctx), "submit"));
            if (!outcome.ok) {
                return act(() => {
                    if (!attempt.superseded) {
                        this._issues$.set([callbackIssue(root, ROOT_PATH, "submit", outcome.error)]);
                    }
                    return this._finish(attempt, "error", false);
                });
            }
            snapshot = untracked(() => root.snapshot());
            // Not batched: the command writes its entry, and a retry is confirmed by reading it.
            flight = untracked(() => this._start(outcome.value, force));
        } finally {
            hold?.unsubscribe();
        }

        const settled = await flight.settled;
        return act(() => this._settle(attempt, settled, flight, snapshot));
    }

    /**
     * Waits for `isPending$` to be false, re-checking after each settle: a settle can start more
     * work (a debounce, a dependent key), which the next round waits for. Ends early when a reset
     * ends the attempt.
     */
    private async _whenNotPending(attempt: Attempt): Promise<void> {
        const isPending$ = this._root.isPending$;
        const settled$ = isPending$.obs.pipe(
            first((isPending) => !isPending),
            takeUntil(attempt.ended$),
        );
        while (this._current === attempt) {
            await firstValueFrom(settled$, { defaultValue: undefined });
            await Promise.resolve();
            if (!untracked(() => isPending$.peek())) return;
        }
    }

    /** Classifies the handler result and starts the command: a retry of the failed request, or a trigger. */
    private _start(result: unknown, force: boolean): Flight {
        const failed = this._failed;
        this._failed = null;

        if (isBoundCommand(result)) {
            const { command, args } = result;
            const request: Request = {
                command,
                // The order of `CommandClutch`: the keyed args, the bound key, the default key.
                entryKey: isKeyed(args) ? args.key : (result.entryKey ?? this._mintedKey()),
                args: isKeyed(args) ? args.value : args,
            };
            const clutch = this._clutchOf(command);
            const entry = command.getEntry(request.entryKey);
            if (!force && failed && sameRequest(failed, request) && entry?.peek().status === "error") {
                const flight = this._retry(clutch, entry, request);
                if (flight) return flight;
            }
            return this._trigger(clutch, args, request);
        }

        if (isThenable(result)) {
            let configError: FormConfigError | undefined;
            const checked = Promise.resolve(result).then((value) => {
                if (!isBoundCommand(value)) return value;
                throw (configError = new FormConfigError(
                    "submit",
                    "returned a promise of a bound command; return command.bind(args) itself, not from an async function",
                ));
            });
            const { command, hand } = promiseCommandOf(this._record);
            hand(checked);
            const request: Request = { command, entryKey: this._mintedKey(), args: undefined };
            const flight = this._trigger(this._clutchOf(command), undefined, request);
            // A promise is not re-run: the attempt is never retried.
            return { ...flight, request: null, configError: () => configError };
        }

        throw new FormConfigError(
            "submit",
            `must return command.bind(args) or a promise (got ${describeValue(result)})`,
        );
    }

    /** A new request: `trigger()` with the resolved key; the outcome is the trigger's envelope. */
    private _trigger(clutch: AnyClutch, args: unknown, request: Request): Flight {
        const envelope = clutch.trigger(args as TArgsOrKeyed<unknown>, request.entryKey);
        const removal = watchRemoval(request.command.getEntry(request.entryKey));
        // Command entries default to retention 0: the root holds the entry until the settle.
        const hold = clutch.state$.obs.subscribe({ error: noop });
        this._track(clutch, request.entryKey);
        const settled = envelope.then((result): Settled =>
            removal.removed
                ? ABORTED
                : result.status === "success"
                  ? SUCCESS
                  : { status: "error", error: result.error },
        );
        return this._flight(settled, [hold, removal], request);
    }

    /**
     * A retry of the failed entry: the same request id. `null` if the entry did not become
     * pending; the attempt then goes through `trigger()`. The outcome is the entry leaving pending.
     */
    private _retry(clutch: AnyClutch, entry: IQueryCacheEntry<unknown, unknown>, request: Request): Flight | null {
        const removal = watchRemoval(entry);
        const hold = clutch.state$.obs.subscribe({ error: noop });
        clutch.retry();
        if (entry.peek().status !== "pending") {
            hold.unsubscribe();
            removal.unsubscribe();
            return null;
        }
        this._track(clutch, request.entryKey);
        const settled = firstValueFrom(clutch.state$.obs.pipe(first((state) => !state.isPending))).then(
            (state): Settled =>
                removal.removed || state.status === "idle"
                    ? ABORTED
                    : state.status === "success"
                      ? SUCCESS
                      : { status: "error", error: state.error },
        );
        return this._flight(settled, [hold, removal], request);
    }

    private _flight(settled: Promise<Settled>, holds: Unsubscribable[], request: Request): Flight {
        return {
            settled: settled.finally(() => {
                for (const hold of holds) hold.unsubscribe();
            }),
            request,
            generation: this._root.scope.bases.generation,
            configError: noConfigError,
        };
    }

    /** The command started: `submission$` mirrors its clutch, the phase is `submitting`. */
    private _track(clutch: AnyClutch, entryKey: string): void {
        act(() => {
            this._entryKey = entryKey;
            this._clutch$.set(clutch);
            this._patch({ phase: "submitting", submitCount: this._meta$.peek().submitCount + 1 });
        });
    }

    /**
     * Applies the settle. A success commits the snapshot unless an `initialize()` wrote the bases
     * since the command started, and rotates the key; an error lays the server issues out. A
     * superseded attempt applies neither its issues nor its outcome.
     */
    private _settle(attempt: Attempt, settled: Settled, flight: Flight, snapshot: GroupSnapshot): boolean {
        const configError = flight.configError();
        if (configError) throw configError;
        switch (settled.status) {
            case "aborted":
                return false;
            case "success":
                if (this._root.scope.bases.generation === flight.generation) commitSnapshot(snapshot);
                this._defaultKey = undefined;
                return this._finish(attempt, "success", true);
            case "error":
                this._failed = flight.request;
                if (!attempt.superseded) {
                    layoutServerIssues(snapshot, toServerIssues(settled.error, this._record.mapSubmitError));
                }
                return this._finish(attempt, "error", false);
        }
    }

    private _finish(attempt: Attempt, outcome: Outcome, result: boolean): boolean {
        if (!attempt.superseded) this._patch({ lastOutcome: outcome });
        return result;
    }

    /** The attempt ended: the phase becomes idle, unless a reset has already taken it away. */
    private _toIdle(attempt: Attempt): void {
        if (this._current !== attempt) return;
        act(() => {
            this._current = null;
            this._patch({ phase: "idle" });
            if (attempt.superseded) this._resetNow();
        });
    }

    private _resetNow(): void {
        this._failed = null;
        this._defaultKey = undefined;
        this._entryKey = undefined;
        this._clutch$.set(null);
        this._issues$.set(NO_ISSUES);
        this._patch({ lastOutcome: "idle" });
    }

    // ==================== Helpers ====================

    private _mintedKey(): string {
        return (this._defaultKey ??= randomUUID());
    }

    private _clutchOf(command: AnyCommand): AnyClutch {
        let clutch = this._clutches.get(command);
        if (!clutch) {
            clutch = command.createClutch();
            this._clutches.set(command, clutch);
        }
        return clutch;
    }

    private _patch(patch: Partial<SubmitMeta>): void {
        const meta = this._meta$.peek();
        const next = { ...meta, ...patch };
        if (!shallowEqual(meta, next)) this._meta$.set(next);
    }
}

// ==================== Functions ====================

/** Watches an entry's lifecycle: `removed` once it completes. */
function watchRemoval(entry: IQueryCacheEntry<unknown, unknown> | null) {
    let removed = false;
    const mark = () => {
        removed = true;
    };
    const subscription = entry?.completed$.subscribe({ next: mark, complete: mark });
    return {
        get removed() {
            return removed;
        },
        unsubscribe: () => subscription?.unsubscribe(),
    };
}

function sameRequest(a: Request, b: Request): boolean {
    return a.command === b.command && a.entryKey === b.entryKey && deepEqual(a.args, b.args);
}

function isBoundCommand(value: unknown): value is TBoundCommand<unknown, unknown, unknown> {
    if (typeof value !== "object" || value === null) return false;
    const bound = value as { kind?: unknown; command?: { createClutch?: unknown } };
    return bound.kind === "command" && typeof bound.command?.createClutch === "function";
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        (typeof value === "object" || typeof value === "function") &&
        value !== null &&
        typeof (value as { then?: unknown }).then === "function"
    );
}

/** The clutch state without `retry`: retries go through `submit()`. */
function withoutRetry(state: AnyClutchState): Omit<AnyClutchState, "retry"> {
    const { retry: _retry, ...rest } = state;
    return rest;
}
