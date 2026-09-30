import type { Observable, Observer, Subscriber, Subscription, TeardownLogic } from "rxjs";

import {
    addDependency,
    afterRead,
    COMPLETED,
    DELIVER_ERROR,
    DELIVER_NOTHING,
    DELIVER_VALUE,
    DISPOSED,
    drainForRead,
    dropFeeders,
    enterConnect,
    failBatch,
    hintWrite,
    inBatch,
    isCycleLimitHit,
    isInsideRead,
    KIND_RECEIVER,
    leaveConnect,
    NodeObservable,
    Producer,
    queueRelease,
    receiverCycleError,
    receiverLive,
    RecoveryWatcher,
    reportUnhandled,
    stopWatchingChanges,
    untracked,
    watch,
    writeProducer,
    type ObsRec,
    type ObsSource,
    type ReceiverLike,
    type WatchableNode,
    type Watcher,
} from "./core";
import { SignalCycleError } from "./SignalCycleError";

/**
 * How long the upstream subscription (and the cached value) survives after the
 * last observer — an `.obs` subscriber, an effect or an observed computed — is
 * gone, or after a read without observers:
 *
 * - `"none"` — no retention: every unobserved read subscribes and tears down;
 * - `"microtask"` — until the current microtask queue drains;
 * - `"task"` — until the next macrotask;
 * - `"forever"` — from the first touch until `dispose()`;
 * - a `number` — a grace window in milliseconds, renewed by every unobserved read.
 */
export type KeepAlive = "none" | "microtask" | "task" | "forever" | number;

const CONNECTING = 1 << 8;
/** The cache cycle is alive: the value (or a sticky error) is authoritative. */
const CONNECTED = 1 << 9;
/** A read of this node drains pending deliveries: it holds the node until the read is done. */
const READING = 1 << 12;
/**
 * The upstream failed while connecting for a new observer, before any read:
 * the read that follows gets that failure instead of retrying at once.
 */
const UNSEEN_FAILURE = 1 << 13;

/** No error. */
const ERR_NONE = 0;
/** An upstream error outside any delivery: the next read reconnects. */
const ERR_TRANSIENT = 1;
/** An error that arrived through a delivery (a bridge): kept until the source changes. */
const ERR_STICKY = 2;

const KIND_VALUE = 0;
const KIND_DEFAULT = 1;
const KIND_ERROR = 2;

/**
 * A node an RxJS callback writes. The upstream is subscribed on the first
 * observer (or a read) and released by `keepAlive` after the last one.
 */
export class ReceiverNode<T> extends Producer implements ReceiverLike, WatchableNode<T>, ObsSource<T> {
    // The fields a read touches first (see Producer).
    private _value: T | undefined = undefined;
    private _hasValue = false;
    private _errorState = ERR_NONE;
    private _lastKind = KIND_DEFAULT;
    private _lastPayload: unknown = undefined;
    _watcher: Watcher | null = null;
    _feeders: Set<ObsRec> | null = null;

    private _obs: Observable<T> | null = null;
    private _sub: Subscription | null = null;
    private _live = false;
    private _error: unknown = undefined;
    private _frozen: { value: T } | null = null;
    private _recovery: RecoveryWatcher | null = null;
    private _graceToken = 0;
    private _timer: ReturnType<typeof setTimeout> | null = null;
    private _releaseQueued = false;
    private readonly _observer: Partial<Observer<T>>;
    readonly _receivers: readonly ReceiverLike[] = [this];
    _gateStamp = 0;
    _gateCount = 0;

    constructor(
        private readonly _upstream: Observable<T>,
        private readonly _keepAlive: KeepAlive,
        private readonly _hasDefault: boolean,
        private readonly _default: T | undefined,
        private readonly _key: string | undefined,
    ) {
        super();
        this._observer = {
            next: (value) => this._onNext(value),
            error: (error: unknown) => this._onError(error),
            complete: () => this._onComplete(),
        };
    }

    override _label(): string {
        return this._key ?? "<anonymous>";
    }

    get obs(): Observable<T> {
        return (this._obs ??= new NodeObservable<T>(this));
    }

    _subscribeObs(subscriber: Subscriber<T>): TeardownLogic {
        if ((this._flags & DISPOSED) !== 0) {
            subscriber.complete();
            return;
        }
        return watch(this, subscriber);
    }

    get(): T {
        if ((this._flags & CONNECTING) !== 0) throw receiverCycleError(this);
        this._drain();
        const link = addDependency(this);
        this._refresh();
        if (link !== undefined) link._version = this._version;
        afterRead();
        return this._readValue();
    }

    peek(): T {
        if ((this._flags & CONNECTING) !== 0) throw receiverCycleError(this);
        this._drain();
        this._refresh();
        afterRead();
        return this._readValue();
    }

    /**
     * Delivers pending `.obs` values first. One of them may complete this
     * node's last observer: the release waits for the end of the read, which
     * would otherwise subscribe the upstream again.
     */
    private _drain(): void {
        this._flags |= READING;
        try {
            drainForRead();
        } finally {
            this._flags &= ~READING;
        }
    }

    override _refresh(): boolean {
        const flags = this._flags;
        if ((flags & DISPOSED) !== 0) return true;
        if ((flags & CONNECTING) !== 0) return false;
        if ((flags & UNSEEN_FAILURE) !== 0) {
            // This read is the one the failure answers; the next one retries.
            this._flags = flags & ~UNSEEN_FAILURE;
            return true;
        }
        if ((flags & CONNECTED) === 0 || this._errorState === ERR_TRANSIENT) this._connect();
        else if (this._targets === undefined) this._scheduleRelease();
        return true;
    }

    _readForDelivery(): T {
        return this._readValue();
    }

    _deliverable(): number {
        if (this._errorState !== ERR_NONE) return DELIVER_ERROR;
        return this._hasValue ? DELIVER_VALUE : DELIVER_NOTHING;
    }

    override _onObserved(): void {
        this._cancelGrace();
        const flags = this._flags;
        if ((flags & DISPOSED) !== 0) return;
        if ((flags & CONNECTED) === 0 || this._errorState === ERR_TRANSIENT) {
            this._connect();
            if (this._errorState === ERR_TRANSIENT) this._flags |= UNSEEN_FAILURE;
        }
    }

    override _onUnobserved(): void {
        if ((this._flags & DISPOSED) !== 0) return;
        if (this._keepAlive === "none" && !isInsideRead() && (this._flags & READING) === 0) {
            this._disconnect();
            return;
        }
        this._scheduleRelease();
    }

    _releaseAfterRead(): void {
        this._releaseQueued = false;
        if (this._targets === undefined) this._disconnect();
    }

    _isDisposedNode(): boolean {
        return (this._flags & DISPOSED) !== 0;
    }

    dispose(): void {
        if ((this._flags & DISPOSED) !== 0) return;
        if ((this._flags & CONNECTED) !== 0 && this._hasValue && this._errorState === ERR_NONE) {
            this._frozen = { value: this._value as T };
        }
        this._disconnect();
        this._flags |= DISPOSED;
        this._watcher?._completeAll();
        this._reconcile();
    }

    /** A new value was committed (devtools). */
    protected _onValue(_value: T): void {}

    // ==================== Upstream ====================

    private _connect(): void {
        if ((this._flags & (CONNECTING | DISPOSED)) !== 0) return;
        this._cancelGrace();
        this._clearRecovery();
        this._flags = (this._flags & ~(COMPLETED | UNSEEN_FAILURE)) | CONNECTING | CONNECTED;
        this._hasValue = false;
        this._errorState = ERR_NONE;
        this._error = undefined;
        this._live = true;
        receiverLive(1);
        enterConnect(this);
        let sub: Subscription | undefined;
        try {
            // The upstream's subscribe function belongs to no consumer's tracking.
            sub = untracked(() => this._upstream.subscribe(this._observer));
        } finally {
            leaveConnect();
            this._flags &= ~CONNECTING;
        }
        if (this._live) {
            this._sub = sub;
        } else if (sub !== undefined) {
            // Released (disposed) while subscribing, or the upstream already ended.
            try {
                sub.unsubscribe();
            } catch (error) {
                reportUnhandled(error);
            }
        }
        this._reconcile();
        if (this._targets === undefined) this._scheduleRelease();
    }

    private _endLive(): void {
        if (!this._live) return;
        this._live = false;
        receiverLive(-1);
        this._sub = null;
    }

    private _disconnect(): void {
        this._cancelGrace();
        this._clearRecovery();
        dropFeeders(this);
        const wasConnected = (this._flags & CONNECTED) !== 0;
        this._flags &= ~(CONNECTED | COMPLETED | UNSEEN_FAILURE);
        // The upstream may emit unseen now: a cold read must check this node again.
        if (wasConnected) stopWatchingChanges();
        if (wasConnected || this._errorState !== ERR_NONE) {
            // The lifecycle clears an error: the next read starts afresh.
            this._errorState = ERR_NONE;
            this._error = undefined;
        }
        if (this._live) {
            this._live = false;
            receiverLive(-1);
            const sub = this._sub;
            this._sub = null;
            try {
                sub?.unsubscribe();
            } catch (error) {
                // A throwing upstream teardown has no caller to go to: the
                // release runs inside the engine's bookkeeping.
                reportUnhandled(error);
            }
        }
    }

    private _onNext(value: T): void {
        if ((this._flags & DISPOSED) !== 0) return;
        hintWrite(this);
        if (isCycleLimitHit()) {
            this._fail(new SignalCycleError([], "Cycle detected: a bridge kept writing after the flush limit"));
            return;
        }
        let cycle: Watcher | null;
        if (this._errorState === ERR_NONE && this._lastKind === KIND_VALUE) {
            // The common case, a value after a value: no state reconciliation needed.
            this._value = value;
            this._hasValue = true;
            if (Object.is(value, this._lastPayload)) return;
            this._lastPayload = value;
            this._onValue(value);
            cycle = writeProducer(this);
        } else {
            this._value = value;
            this._hasValue = true;
            this._errorState = ERR_NONE;
            this._error = undefined;
            cycle = this._reconcile();
        }
        if (cycle !== null) {
            this._fail(new SignalCycleError([cycle._node._label(), this._label(), cycle._node._label()]));
        }
    }

    /** An engine-detected failure: becomes the sticky state and the error of the batch. */
    private _fail(error: SignalCycleError): void {
        this._errorState = ERR_STICKY;
        this._error = error;
        this._hasValue = false;
        this._reconcile();
        if (inBatch()) failBatch(error);
        else throw error;
    }

    private _onError(error: unknown): void {
        if ((this._flags & DISPOSED) !== 0) return;
        this._endLive();
        const rec = hintWrite(this);
        if (rec !== null) {
            // Through a delivery: the error is the state until the delivering node changes.
            this._errorState = ERR_STICKY;
            this._clearRecovery();
            const node = rec.node as WatchableNode;
            this._recovery = new RecoveryWatcher(node, node._version, () => this._recover());
            // A delivery can write it again (the recovery): the gate must order it.
            receiverLive(1);
        } else {
            this._errorState = ERR_TRANSIENT;
            this._flags &= ~CONNECTED;
            if ((this._flags & CONNECTING) !== 0 && this._lastKind === KIND_ERROR) {
                // A retry that failed again at once: still the same failure for
                // readers, or every read would wake them to retry again.
                this._error = error;
                this._lastPayload = error;
                this._hasValue = false;
                return;
            }
        }
        this._error = error;
        this._hasValue = false;
        this._reconcile();
    }

    private _onComplete(): void {
        if ((this._flags & DISPOSED) !== 0) return;
        // The cache stays valid: a completed source is served until the lifecycle
        // releases it, and `.obs` subscribers complete after its last value.
        this._endLive();
        this._flags |= COMPLETED;
        this._watcher?._complete();
    }

    /** The node whose delivery failed changed: subscribe the chain afresh. */
    private _recover(): void {
        this._recovery = null;
        receiverLive(-1);
        if ((this._flags & DISPOSED) !== 0) return;
        this._flags &= ~CONNECTED;
        this._connect();
    }

    private _clearRecovery(): void {
        const recovery = this._recovery;
        if (recovery === null) return;
        this._recovery = null;
        receiverLive(-1);
        recovery._stop();
    }

    // ==================== State ====================

    private _readValue(): T {
        if ((this._flags & DISPOSED) !== 0) {
            if (this._frozen !== null) return this._frozen.value;
            return this._defaultOrThrow();
        }
        if (this._errorState !== ERR_NONE) throw this._error;
        if (this._hasValue) return this._value as T;
        return this._defaultOrThrow();
    }

    private _defaultOrThrow(): T {
        if (this._hasDefault) return this._default as T;
        throw new Error("No value emitted");
    }

    /**
     * Compares the state readers see with the last one they were told about;
     * on a change bumps the version and marks the dependents. Returns the
     * watcher the write fed back into (a synchronous cycle), or null.
     */
    private _reconcile(): Watcher | null {
        let kind: number;
        let payload: unknown;
        if ((this._flags & DISPOSED) !== 0) {
            kind = this._frozen !== null ? KIND_VALUE : KIND_DEFAULT;
            payload = this._frozen?.value;
        } else if (this._errorState !== ERR_NONE) {
            kind = KIND_ERROR;
            payload = this._error;
        } else if (this._hasValue) {
            kind = KIND_VALUE;
            payload = this._value;
        } else {
            kind = KIND_DEFAULT;
            payload = undefined;
        }
        if (kind === this._lastKind && Object.is(payload, this._lastPayload)) return null;
        this._lastKind = kind;
        this._lastPayload = payload;
        if (kind === KIND_VALUE && (this._flags & DISPOSED) === 0) this._onValue(payload as T);
        return writeProducer(this);
    }

    // ==================== keepAlive ====================

    private _scheduleRelease(): void {
        const keepAlive = this._keepAlive;
        if (keepAlive === "forever") return;
        if (keepAlive === "none") {
            if (!this._releaseQueued) {
                this._releaseQueued = true;
                queueRelease(this);
            }
            return;
        }
        const token = ++this._graceToken;
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        const expire = () => {
            this._timer = null;
            if (token !== this._graceToken) return;
            if (this._targets === undefined && (this._flags & DISPOSED) === 0) this._disconnect();
        };
        if (keepAlive === "microtask") queueMicrotask(expire);
        else this._timer = setTimeout(expire, keepAlive === "task" ? 0 : keepAlive);
    }

    private _cancelGrace(): void {
        this._graceToken++;
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }
}
Object.defineProperty(ReceiverNode.prototype, "_kind", { value: KIND_RECEIVER, writable: true });
