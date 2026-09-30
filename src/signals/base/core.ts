/**
 * The push-pull engine: a write marks its dependents (push), a read brings a
 * marked node up to date (pull). Dependency links are the nodes' own doubly
 * linked lists; RxJS appears only at the edges (`.obs`, `Signal.from`).
 *
 * Internal module: nothing here is part of the public API.
 *
 * The dependency tracking (flags, `Link` lists, `needsToRecompute`,
 * `cleanupSources`) is derived from @preact/signals-core,
 * Copyright (c) 2022-present Preact Team, MIT License (see LICENSE).
 */
import { config, Observable, type Subscriber, type TeardownLogic } from "rxjs";

import { SignalCycleError } from "./SignalCycleError";

// ==================== Flags ====================

/** A computed is evaluating (or checking its sources); an effect is running its body. */
export const RUNNING = 1 << 0;
/** Already notified in the current wave: repeated notifications stop here. */
export const NOTIFIED = 1 << 1;
/** A computed must check its sources before its value is trusted. */
export const OUTDATED = 1 << 2;
export const DISPOSED = 1 << 3;
/** A computed holds the error its computeFn threw. */
export const HAS_ERROR = 1 << 4;
/** A consumer that keeps its source links subscribed (hot). */
export const TRACKING = 1 << 5;
/** An effect was notified while its body ran (its own write): sorted out when the run ends. */
export const NOTIFIED_WHILE_RUNNING = 1 << 6;
/** A producer has observers: its lifecycle hook ran. */
export const OBSERVED = 1 << 7;
/** A computed that just became observed: computes afresh instead of trusting its cached state. */
export const RETRY = 1 << 8;
/** A computed holds a value (it may hold an error on top of an older value). */
export const HAS_VALUE = 1 << 9;
/** A computed reports new states to `_onNewState` (devtools). */
export const REPORTS_STATE = 1 << 10;
/** A receiver whose upstream completed: its `.obs` subscribers complete after its last value. */
export const COMPLETED = 1 << 11;

/** What a node gives `.obs` now: nothing (a receiver that has not emitted), a value or an error. */
export const DELIVER_NOTHING = 0;
export const DELIVER_VALUE = 1;
export const DELIVER_ERROR = 2;

/** Producer kinds, for the delivery gate (which receivers a node depends on). */
export const KIND_SOURCE = 0;
export const KIND_COMPUTED = 1;
export const KIND_RECEIVER = 2;

/**
 * Generations of reactions in one flush before writes are refused. A reaction
 * (an effect run, a watcher's delivery) queued by one of generation g is of
 * generation g + 1: a loop deepens with every round, a wide graph does not.
 */
const CYCLE_LIMIT = 1000;
/** Safety net: the generation at which the flush is abandoned. */
const HARD_LIMIT = 2 * CYCLE_LIMIT;

export const NONE: unique symbol = Symbol("rx-toolkit/none");

/** A node whose `.obs` is a {@link NodeObservable}. */
export interface ObsSource<T> {
    /** Subscribes one `.obs` subscriber. */
    _subscribeObs(subscriber: Subscriber<T>): TeardownLogic;
}

/**
 * The `.obs` of a node: one object that hands each subscription to the node,
 * instead of a subscribe closure and its scope per node. Every signal creates
 * its `.obs` eagerly, and objects a read never touches, placed between the
 * ones it does, cost the hot path cache lines. `_subscribe` is the hook RxJS
 * calls for every subscription (the one `Subject` overrides).
 */
export class NodeObservable<T> extends Observable<T> {
    constructor(private readonly _node: ObsSource<T>) {
        super();
    }

    protected _subscribe(subscriber: Subscriber<T>): TeardownLogic {
        return this._node._subscribeObs(subscriber);
    }
}

// ==================== Links ====================

/** An edge `source → target`, a node of two lists: the target's sources and the source's targets. */
export class Link {
    _prevTarget: Link | undefined = undefined;
    _nextTarget: Link | undefined = undefined;
    _nextSource: Link | undefined = undefined;

    constructor(
        public _source: Producer,
        public _target: Consumer,
        public _version: number,
        public _prevSource: Link | undefined,
        public _rollback: Link | undefined,
    ) {}
}

/** A node that reads producers: a computed, an effect, an `.obs` watcher. */
export interface Consumer {
    _flags: number;
    /** Head of the source list (the tail while an evaluation tracks by marks). */
    _sources: Link | undefined;
    _notify(): void;
}

/** A consumer whose reads are tracked while it evaluates: a computed, an effect. */
interface Evaluator extends Consumer {
    /** While it evaluates: the last source link its reads confirmed, in order. */
    _depsTail: Link | undefined;
    /** While it evaluates: its reads left the previous order, it tracks by the producers' `_node` marks. */
    _byMarks: boolean;
}

// ==================== Global state ====================

/** The consumer whose reads are tracked right now. */
let evalContext: Evaluator | undefined = undefined;
/** Computeds a read found still computing (cycles), innermost last; each leaves when its computation ends. */
const cycleNodes: Producer[] = [];
/** Bumped by every read that finds a computed still computing. */
let cycleHits = 0;
/** Bumped on every value change anywhere: a cold computed that saw it is valid. */
let globalVersion = 0;
let batchDepth = 0;
let flushing = false;
let draining = false;
/** Computeds with RUNNING set: "inside an evaluation". */
let runningDepth = 0;

let connectDepth = 0;
let deliveryDepth = 0;
/**
 * Engine frames, innermost last: deliveries to `.obs` subscribers and
 * connecting receivers. Stacks and queues here keep their arrays and move an
 * index: shrinking an array's length reallocates it on the next push.
 */
const frameStack: (ObsRec | ReceiverLike | undefined)[] = [];
let frameDepth = 0;
/** A write happened where no flush could run (inside an evaluation or a connect). */
let deferredFlush = false;
/** Work a read may leave behind: a deferred flush or receivers to release. */
let settlePending = false;

/** FIFO of effects to run, linked through `_nextQueued`. */
let effectFirst: EffectNode | undefined = undefined;
let effectLast: EffectNode | undefined = undefined;
/** Watchers to deliver, `[watchHead, watchTail)`; a hole is one the gate delivered out of order. */
const watchQueue: (Watcher | null)[] = [];
let watchHead = 0;
let watchTail = 0;
const afterFlushQueue: (() => void)[] = [];
/** Receivers whose upstream subscription is live: a delivery can write them. */
let connectedReceivers = 0;
/** Bumped whenever a source link appears or disappears: invalidates the gate's receiver sets. */
let structureEpoch = 0;
/** Bumped by what the gate's decision reads: a watcher queued or marked, a hint, a connection, a round. */
let gateEpoch = 0;
/** Receivers with keepAlive "none" read while unobserved: released after the outermost read. */
const releaseQueue: ReceiverLike[] = [];

/** A State write waiting for its `.obs` subscribers (see `SourceNode._deliverRecs`); version -1: its dispose. */
interface StateDelivery {
    node: SourceNode<unknown>;
    value: unknown;
    version: number;
    gen: number;
}
/** State writes to deliver, `[stateHead, stateTail)`, in write order. */
const stateQueue: (StateDelivery | null)[] = [];
let stateHead = 0;
let stateTail = 0;
/** A State delivery runs: the subscribers of a write made meanwhile wait in `stateQueue`. */
let stateDelivering = false;

let hasBatchError = false;
let batchError: unknown = undefined;
/** Generation of the reaction running now; 0 outside reactions (a write that starts a flush). */
let generation = 0;
let cycleLimitHit = false;
/** The watcher notified while it was delivering: a synchronous cycle through a bridge. */
let cycleWatcher: Watcher | null = null;

// ==================== Producers ====================

const EMPTY_RECEIVERS: readonly ReceiverLike[] = [];

/**
 * A node others read: a source, a computed or a receiver. The fields every
 * read and write touches come first in every node; rarely used ones are
 * declared last, so a node's hot fields share as few cache lines as possible.
 */
export abstract class Producer {
    declare readonly _kind: number;
    _flags = 0;
    _version = 0;
    /** While a consumer tracks its reads by marks: its link to this node (see addDependency). */
    _node: Link | undefined = undefined;
    _targets: Link | undefined = undefined;
    _targetsTail: Link | undefined = undefined;

    /** Brings the node up to date. `false` — it is running (a cycle). */
    _refresh(): boolean {
        return true;
    }

    _subscribe(link: Link): void {
        if (link._prevTarget !== undefined || this._targets === link) return;
        if (this._targets === undefined && (this._flags & OBSERVED) === 0) {
            this._flags |= OBSERVED;
            try {
                this._onObserved();
            } catch (error) {
                // Not observed after all: the next observer tries again.
                this._flags &= ~OBSERVED;
                throw error;
            }
        }
        const tail = this._targetsTail;
        if (tail === undefined) {
            this._targets = link;
        } else {
            tail._nextTarget = link;
            link._prevTarget = tail;
        }
        this._targetsTail = link;
    }

    _unsubscribe(link: Link): void {
        const prev = link._prevTarget;
        const next = link._nextTarget;
        if (prev === undefined && this._targets !== link) return;
        if (prev !== undefined) prev._nextTarget = next;
        else this._targets = next;
        if (next !== undefined) next._prevTarget = prev;
        else this._targetsTail = prev;
        link._prevTarget = undefined;
        link._nextTarget = undefined;
        if (this._targets === undefined && (this._flags & OBSERVED) !== 0) {
            this._flags &= ~OBSERVED;
            this._onUnobserved();
        }
    }

    /** The first observer arrived (called before it is linked). */
    _onObserved(): void {}

    /** The last observer left. */
    _onUnobserved(): void {}

    _notifyTargets(): void {
        for (let link = this._targets; link !== undefined; link = link._nextTarget) {
            link._target._notify();
        }
    }

    /** Label for cycle chains. */
    _label(): string {
        return "<anonymous>";
    }
}
Object.defineProperty(Producer.prototype, "_kind", { value: KIND_SOURCE, writable: true });

// ==================== Tracking ====================

/**
 * Records `source` as a dependency of the evaluating consumer; returns the link
 * to stamp, or undefined for a repeated read. An evaluation that reads its
 * sources in the order of the previous one only moves a cursor along its
 * links; the first read off that order switches it to tracking by marks.
 */
export function addDependency(source: Producer): Link | undefined {
    const ctx = evalContext;
    if (ctx === undefined) return undefined;
    if (!ctx._byMarks) {
        const tail = ctx._depsTail;
        let next: Link | undefined;
        if (tail !== undefined) {
            if (tail._source === source) return undefined;
            next = tail._nextSource;
        } else {
            next = ctx._sources;
        }
        if (next !== undefined && next._source === source) {
            ctx._depsTail = next;
            return next;
        }
        if (readRecently(tail, source)) return undefined;
        startTrackingByMarks(ctx);
    }
    const link = source._node;
    if (link === undefined || link._target !== ctx) return newDependency(source, ctx, link);
    if (link._version === -1) {
        // Reused from the previous evaluation.
        link._version = 0;
        if (link._nextSource !== undefined) moveToTail(link, ctx);
        return link;
    }
    return undefined;
}

/** How far back a read off the order looks for a repeat before tracking by marks. */
const REPEAT_SCAN = 8;

/** Whether one of the last reads the evaluation confirmed was of `source` (a repeat keeps the order). */
function readRecently(tail: Link | undefined, source: Producer): boolean {
    for (let n = 0; tail !== undefined && n < REPEAT_SCAN; n++, tail = tail._prevSource) {
        if (tail._source === source) return true;
    }
    return false;
}

function newDependency(source: Producer, ctx: Consumer, rollback: Link | undefined): Link {
    const link = new Link(source, ctx, 0, ctx._sources, rollback);
    if (ctx._sources !== undefined) ctx._sources._nextSource = link;
    ctx._sources = link;
    source._node = link;
    structureEpoch++;
    if ((ctx._flags & TRACKING) !== 0) source._subscribe(link);
    return link;
}

/** Keeps the source list in read order: a reused link moves to the tail. */
function moveToTail(link: Link, ctx: Consumer): void {
    const next = link._nextSource!;
    next._prevSource = link._prevSource;
    if (link._prevSource !== undefined) link._prevSource._nextSource = next;
    link._prevSource = ctx._sources;
    link._nextSource = undefined;
    ctx._sources!._nextSource = link;
    ctx._sources = link;
}

function needsToRecompute(target: Consumer): boolean {
    for (let link = target._sources; link !== undefined; link = link._nextSource) {
        const source = link._source;
        if (source._version !== link._version || !source._refresh() || source._version !== link._version) {
            return true;
        }
    }
    return false;
}

/** Starts tracking the reads of an evaluation. */
function beginTracking(target: Evaluator): void {
    target._depsTail = undefined;
}

/** Ends tracking: drops the links the evaluation did not read. */
function endTracking(target: Evaluator): void {
    if (target._byMarks) {
        target._byMarks = false;
        cleanupSources(target);
        return;
    }
    const tail = target._depsTail;
    let link = tail !== undefined ? tail._nextSource : target._sources;
    if (link === undefined) return;
    if (tail !== undefined) tail._nextSource = undefined;
    else target._sources = undefined;
    structureEpoch++;
    for (; link !== undefined; link = link._nextSource) unsubscribeQuietly(link);
}

/**
 * A read off the previous order: marks every link on its producer (`_node`,
 * the previous mark kept in `_rollback`) - the links read so far as confirmed,
 * the rest as unread (-1) - and leaves `_sources` at the tail, where new and
 * reused links are appended in read order.
 */
function startTrackingByMarks(target: Evaluator): void {
    target._byMarks = true;
    const confirmed = target._depsTail;
    let unread = confirmed === undefined;
    for (let link = target._sources; link !== undefined; link = link._nextSource) {
        const rollback = link._source._node;
        if (rollback !== undefined) link._rollback = rollback;
        link._source._node = link;
        if (unread) link._version = -1;
        else if (link === confirmed) unread = true;
        if (link._nextSource === undefined) {
            target._sources = link;
            break;
        }
    }
}

function cleanupSources(target: Consumer): void {
    let link = target._sources;
    let head: Link | undefined = undefined;
    while (link !== undefined) {
        const prev = link._prevSource;
        if (link._version === -1) {
            unsubscribeQuietly(link);
            if (prev !== undefined) prev._nextSource = link._nextSource;
            if (link._nextSource !== undefined) link._nextSource._prevSource = prev;
            structureEpoch++;
        } else {
            head = link;
        }
        link._source._node = link._rollback;
        if (link._rollback !== undefined) link._rollback = undefined;
        link = prev;
    }
    target._sources = head;
}

function unlinkSources(target: Consumer): void {
    for (let link = target._sources; link !== undefined; link = link._nextSource) {
        unsubscribeQuietly(link);
    }
    target._sources = undefined;
    structureEpoch++;
}

/**
 * Drops a link inside the bookkeeping of a consumer: a last-observer hook that
 * throws (an upstream teardown) must not leave the source list half rebuilt.
 */
function unsubscribeQuietly(link: Link): void {
    try {
        link._source._unsubscribe(link);
    } catch (error) {
        reportUnhandled(error);
    }
}

/** An error nobody can handle synchronously, reported the way RxJS reports one. */
export function reportUnhandled(error: unknown): void {
    if (config.onUnhandledError) {
        config.onUnhandledError(error);
        return;
    }
    setTimeout(() => {
        throw error;
    });
}

/** Whether a consumer is evaluating right now (reads are dependencies). */
export function isTracking(): boolean {
    return evalContext !== undefined;
}

/**
 * Runs `fn` outside the calling dependency-tracking scope: signals it reads do
 * not become dependencies of the `Computed` / `Effect` that is running now.
 */
export function untracked<T>(fn: () => T): T {
    const prev = evalContext;
    evalContext = undefined;
    try {
        return fn();
    } finally {
        evalContext = prev;
    }
}

// ==================== Batches ====================

/** Ends a batch; the outermost one flushes and rethrows the first error of the batch. */
export function endBatch(): void {
    if (batchDepth > 1) {
        batchDepth--;
        return;
    }
    if (effectFirst === undefined && watchHead === watchTail && afterFlushQueue.length === 0) {
        batchDepth--;
        // State deliveries may have reached the loop limit with nothing to flush.
        cycleLimitHit = false;
        if (hasBatchError) throwBatchError();
        return;
    }
    if (runningDepth !== 0 || connectDepth !== 0) {
        // Inside an evaluation or a connect: the outer read settles the queues.
        batchDepth--;
        deferredFlush = true;
        settlePending = true;
        throwBatchError();
        return;
    }
    let failure: unknown = NONE;
    try {
        flush();
    } catch (error) {
        failure = error;
    } finally {
        batchDepth--;
    }
    // The first error of the batch wins; an abandoned flush reports its own otherwise.
    if (hasBatchError) throwBatchError();
    if (failure !== NONE) throw failure;
}

function throwBatchError(): void {
    if (!hasBatchError) return;
    const error = batchError;
    hasBatchError = false;
    batchError = undefined;
    throw error;
}

/** Records the first error of the batch; the outermost batch rethrows it. */
export function failBatch(error: unknown): void {
    if (hasBatchError) return;
    hasBatchError = true;
    batchError = error;
}

export function inBatch(): boolean {
    return batchDepth > 0;
}

/**
 * `Batcher.run`: nested runs call `fn` directly; the outermost one runs every
 * reaction even if `fn` or a reaction throws, then rethrows the first error.
 */
export function runBatch<T>(fn: () => T): T {
    if (batchDepth > 0) return fn();
    batchDepth++;
    let result: T | undefined;
    try {
        result = fn();
    } catch (error) {
        failBatch(error);
    }
    endBatch();
    return result as T;
}

/** Runs `fn` after the current flush, when every reaction has run; now if no batch is open. */
export function scheduleAfterFlush(fn: () => void): void {
    if (batchDepth === 0) {
        fn();
        return;
    }
    afterFlushQueue.push(fn);
}

/** Settles work a read left behind: releases, and a flush deferred by an evaluation. */
export function afterRead(): void {
    if (!settlePending || runningDepth !== 0 || connectDepth !== 0) return;
    settlePending = false;
    if (releaseQueue.length !== 0) {
        const released = releaseQueue.splice(0);
        for (const receiver of released) receiver._releaseAfterRead();
    }
    if (deferredFlush) {
        if (batchDepth !== 0) {
            // The enclosing batch flushes.
            settlePending = true;
            return;
        }
        deferredFlush = false;
        batchDepth++;
        endBatch();
    }
}

/** Checks the generation of a reaction about to run; call it while the reaction is still queued. */
function checkGeneration(gen: number): void {
    if (gen > CYCLE_LIMIT) {
        cycleLimitHit = true;
        if (gen > HARD_LIMIT) abandonFlush();
    }
}

/** A write is refused once the flush reached too deep a generation: the loop dies out. */
export function assertWriteAllowed(): void {
    if (cycleLimitHit) throw loopError();
}

export function isCycleLimitHit(): boolean {
    return cycleLimitHit;
}

function loopError(): SignalCycleError {
    return new SignalCycleError(
        [],
        `Cycle detected: reactions did not settle after ${CYCLE_LIMIT} iterations (a loop through effects or bridges)`,
    );
}

function abandonFlush(): never {
    for (let effect = effectFirst; effect !== undefined;) {
        const next: EffectNode | undefined = effect._nextQueued;
        effect._nextQueued = undefined;
        effect._flags &= ~NOTIFIED;
        releaseMarks(effect);
        effect = next;
    }
    effectFirst = effectLast = undefined;
    for (let i = watchHead; i < watchTail; i++) {
        const watcher = watchQueue[i];
        watchQueue[i] = null;
        if (watcher === null) continue;
        watcher._queued = false;
        releaseMarks(watcher);
    }
    watchHead = watchTail = 0;
    throw loopError();
}

/**
 * A dropped consumer's computed sources keep NOTIFIED, which would stop every
 * later notification at them: clear it (OUTDATED stays, so they recompute).
 */
function releaseMarks(consumer: Consumer): void {
    for (let link = consumer._sources; link !== undefined; link = link._nextSource) {
        const source = link._source;
        if (source._kind === KIND_COMPUTED && (source._flags & NOTIFIED) !== 0) {
            source._flags &= ~NOTIFIED;
            releaseMarks(source as ComputedNode<unknown>);
        }
    }
}

function flush(): void {
    flushing = true;
    const prevContext = evalContext;
    evalContext = undefined;
    try {
        for (;;) {
            if (watchHead !== watchTail) {
                gateRound();
                continue;
            }
            const effect = effectFirst;
            if (effect !== undefined) {
                checkGeneration(effect._gen);
                effectFirst = effect._nextQueued;
                if (effectFirst === undefined) effectLast = undefined;
                effect._nextQueued = undefined;
                generation = effect._gen;
                effect._run();
                continue;
            }
            if (afterFlushQueue.length === 0) break;
            const fn = afterFlushQueue.shift()!;
            try {
                fn();
            } catch (error) {
                failBatch(error);
            }
        }
    } finally {
        evalContext = prevContext;
        flushing = false;
        deferredFlush = false;
        settlePending = releaseQueue.length !== 0;
        generation = 0;
        cycleLimitHit = false;
    }
}

function enqueueEffect(effect: EffectNode): void {
    effect._gen = generation + 1;
    if (effectLast === undefined) effectFirst = effect;
    else effectLast._nextQueued = effect;
    effectLast = effect;
}

function enqueueWatcher(watcher: Watcher): void {
    watcher._gen = generation + 1;
    gateEpoch++;
    watchQueue[watchTail++] = watcher;
}

/**
 * A read by user code or an effect body: delivers pending `.obs` values into
 * the RxJS chains first, so a receiver they write is current. Reads inside an
 * evaluation, a delivery or a connect are covered by the outer read.
 */
export function drainForRead(): void {
    if (
        watchHead === watchTail ||
        connectedReceivers === 0 ||
        runningDepth !== 0 ||
        deliveryDepth !== 0 ||
        connectDepth !== 0 ||
        draining
    ) {
        return;
    }
    const outermost = !flushing;
    const reader = generation;
    draining = true;
    batchDepth++;
    try {
        while (watchHead < watchTail) gateRound();
    } finally {
        draining = false;
        generation = reader;
        if (outermost) cycleLimitHit = false;
        endBatch();
    }
}

// ==================== State-like sources ====================

/** A plain source: a value written with `_write`. */
export class SourceNode<T> extends Producer {
    /** `.obs` subscribers, delivered at write time (not queued). */
    _recs: RecList | null = null;

    constructor(public _value: T) {
        super();
    }

    get(): T {
        const link = addDependency(this);
        if (link !== undefined) link._version = this._version;
        return this._value;
    }

    peek(): T {
        return this._value;
    }

    /** Writes a new value (Object.is dedupe is the caller's); `before` runs inside the batch first. */
    _write(value: T, before?: () => void): void {
        if (cycleLimitHit) {
            const error = loopError();
            failBatch(error);
            // An RxJS callback would swallow the throw: the batch reports it instead.
            if (deliveryDepth !== 0) return;
            throw error;
        }
        batchDepth++;
        if (before !== undefined) {
            try {
                before();
            } catch (error) {
                // A hook failed before the write: nothing changed, the error goes to the caller.
                if (batchDepth > 1) {
                    batchDepth--;
                    throw error;
                }
                failBatch(error);
                endBatch();
                return;
            }
        }
        this._value = value;
        this._version++;
        globalVersion++;
        try {
            for (let link = this._targets; link !== undefined; link = link._nextTarget) {
                link._target._notify();
            }
            if (this._recs !== null) this._deliverRecs(value);
        } catch (error) {
            // An exception no reaction owns (a stack exhausted by a deep graph): the batch still ends.
            failBatch(error);
        }
        endBatch();
    }

    /**
     * Delivers a write to `.obs` subscribers: to bridges at once, then to the
     * others in write order. A write made while a delivery runs (a subscriber
     * writing) reaches the others once that subscriber returns, so a loop of
     * subscribers is a loop of reactions, one generation per write, and not
     * a recursion that exhausts the stack.
     */
    private _deliverRecs(value: T): void {
        const recs = this._recs!;
        if (recs.others.length !== 0) {
            stateQueue[stateTail++] = {
                node: this as SourceNode<unknown>,
                value,
                version: this._version,
                gen: generation + 1,
            };
        }
        if (stateDelivering) {
            if (recs.bridges.length !== 0) this._deliverBridges(recs, value);
            return;
        }
        stateDelivering = true;
        try {
            if (recs.bridges.length !== 0) this._deliverBridges(recs, value);
            drainStateQueue();
        } finally {
            stateDelivering = false;
        }
    }

    private _deliverBridges(recs: RecList, value: T): void {
        const list = recs.bridges;
        const version = this._version;
        const n = list.length;
        recs.delivering++;
        try {
            for (let i = 0; i < n; i++) {
                // A newer write inside the chain already reached the bridges.
                if (this._version !== version) break;
                deliverGuarded(list[i], value);
            }
        } finally {
            recs.endDelivery();
        }
    }

    /** Delivers a queued write to the subscribers that were there when it was made. */
    _deliverQueued(value: unknown, version: number): void {
        const recs = this._recs;
        if (recs === null) return;
        const list = recs.others;
        const n = list.length;
        recs.delivering++;
        try {
            for (let i = 0; i < n; i++) {
                const rec = list[i];
                if (rec.since < version) deliverGuarded(rec, value);
            }
        } finally {
            recs.endDelivery();
        }
    }

    /** `.obs` subscription: the current value now, then every write. */
    _watchImmediate(subscriber: Subscriber<T>, disposed: boolean): TeardownLogic {
        if (disposed) {
            subscriber.complete();
            return;
        }
        const rec = new ObsRec(this, subscriber);
        rec.since = this._version;
        linkRecContext(rec);
        (this._recs ??= new RecList()).add(rec);
        deliverTo(rec, this._value, NONE);
        return () => this._removeRec(rec);
    }

    _removeRec(rec: ObsRec): void {
        if (rec.closed) return;
        this._recs?.remove(rec);
    }

    /** Completes every `.obs` subscriber (dispose), after the writes still waiting for them. */
    _completeRecs(): void {
        if (this._recs === null) return;
        if (stateDelivering) {
            stateQueue[stateTail++] = {
                node: this as SourceNode<unknown>,
                value: undefined,
                version: -1,
                gen: generation + 1,
            };
            return;
        }
        this._finishRecs();
    }

    _finishRecs(): void {
        const recs = this._recs;
        if (recs === null) return;
        this._recs = null;
        for (const rec of recs.takeAll()) if (!rec.closed) completeTo(rec);
    }
}

// ==================== Computed ====================

export class ComputedNode<T> extends Producer implements Evaluator, ObsSource<T> {
    _sources: Link | undefined = undefined;
    _depsTail: Link | undefined = undefined;
    _byMarks = false;
    _globalVersion = globalVersion - 1;
    _value: T | undefined = undefined;
    readonly _fn: () => T;
    readonly _equals: ((previous: T, next: T) => boolean) | undefined;
    _error: unknown = undefined;
    readonly _key: string;
    _watcher: Watcher | null = null;
    private _obs: Observable<T> | null = null;
    /** Gate cache: receivers this node depends on, valid for `_rEpoch`. */
    _rEpoch = -1;
    _receivers: readonly ReceiverLike[] = EMPTY_RECEIVERS;

    constructor(fn: () => T, equals: ((previous: T, next: T) => boolean) | undefined, key: string) {
        super();
        this._fn = fn;
        this._equals = equals;
        this._key = key;
        this._flags = OUTDATED;
    }

    override _label(): string {
        return this._key;
    }

    get(): T {
        // Kept small: this is the read every computeFn makes, and it must inline.
        if ((this._flags & RUNNING) !== 0 || watchHead !== watchTail) return this._readSlow(true);
        const link = addDependency(this);
        if ((this._flags & (OUTDATED | TRACKING)) !== TRACKING) {
            if (evalContext === undefined && batchDepth !== 0) return this._readInBatch();
            this._refresh();
        }
        if (link !== undefined) link._version = this._version;
        if ((this._flags & HAS_ERROR) !== 0) throw this._error;
        return this._value as T;
    }

    peek(): T {
        if ((this._flags & RUNNING) !== 0 || watchHead !== watchTail) return this._readSlow(false);
        if ((this._flags & (OUTDATED | TRACKING)) !== TRACKING) {
            if (evalContext === undefined && batchDepth !== 0) return this._readInBatch();
            this._refresh();
        }
        if ((this._flags & HAS_ERROR) !== 0) throw this._error;
        return this._value as T;
    }

    /** A read of a running computed (a cycle), or one that first drains pending `.obs` deliveries. */
    private _readSlow(tracked: boolean): T {
        if ((this._flags & RUNNING) !== 0) {
            cycleHits++;
            if (cycleNodes[cycleNodes.length - 1] !== this) cycleNodes.push(this);
            throw cycleError(this);
        }
        // Only a delivery that can write a receiver this node reads may change
        // it; a node not computed yet may read any.
        if (this._version === 0 || receiversOf(this).length !== 0) drainForRead();
        if (evalContext === undefined && batchDepth !== 0) return this._readInBatch();
        const link = tracked ? addDependency(this) : undefined;
        this._refresh();
        if (link !== undefined) link._version = this._version;
        if ((this._flags & HAS_ERROR) !== 0) throw this._error;
        return this._value as T;
    }

    /**
     * An untracked read while a batch is open. An observed computed the batch
     * marked is computed for this read only: its sources stay as they are
     * until a reaction reads it. Otherwise the batch's intermediate state
     * would start and stop what the computed observes (a cache entry's hold,
     * an upstream subscription) before the batch is over.
     */
    private _readInBatch(): T {
        if ((this._flags & (OUTDATED | TRACKING | RETRY)) !== (OUTDATED | TRACKING) || flushing || draining) {
            this._refresh();
            if ((this._flags & HAS_ERROR) !== 0) throw this._error;
            return this._value as T;
        }
        // Later writes of the batch must reach the targets it gains meanwhile.
        this._flags = (this._flags & ~NOTIFIED) | RUNNING;
        runningDepth++;
        const hits = cycleHits;
        let value = undefined as T;
        let error: unknown = NONE;
        try {
            value = this._fn();
        } catch (caught) {
            error = caught;
        } finally {
            runningDepth--;
            this._flags &= ~RUNNING;
        }
        if (cycleHits !== hits) this._afterCycle(false);
        if (settlePending && runningDepth === 0) afterRead();
        if (error !== NONE) throw error;
        if ((this._flags & (HAS_VALUE | HAS_ERROR)) === HAS_VALUE) {
            const previous = this._value as T;
            if (Object.is(previous, value) || (this._equals !== undefined && this._isEqual(previous, value))) {
                return previous;
            }
        }
        return value;
    }

    override _refresh(): boolean {
        const flags = this._flags & ~NOTIFIED;
        if ((flags & (RUNNING | OUTDATED | TRACKING)) === TRACKING) {
            // Observed and not marked: current.
            this._flags = flags;
            return true;
        }
        if ((flags & RUNNING) !== 0) {
            this._flags = flags;
            return false;
        }
        // The first observer computes afresh (a computeFn may read state outside
        // the graph); an error is kept only while observed.
        const retry =
            (flags & (RETRY | HAS_ERROR)) !== 0 &&
            ((flags & RETRY) !== 0 || (flags & (HAS_ERROR | TRACKING)) === HAS_ERROR);
        if (!retry && this._globalVersion === globalVersion) {
            this._flags = flags & ~OUTDATED;
            return true;
        }
        this._flags = (flags & ~(OUTDATED | RETRY)) | RUNNING;
        this._globalVersion = globalVersion;
        runningDepth++;
        const hits = cycleHits;
        try {
            if (retry || this._version === 0 || needsToRecompute(this)) this._recompute(retry);
        } finally {
            runningDepth--;
            this._flags &= ~RUNNING;
        }
        if (cycleHits !== hits) this._afterCycle(true);
        if (settlePending && runningDepth === 0) afterRead();
        return true;
    }

    /**
     * The computation found a node still computing (a cycle). If this node is
     * that one, the cycle is closed and its outcome stands. Otherwise this
     * node's outcome follows from an unfinished computation: it is provisional,
     * and the next read computes it again from that node's final state.
     */
    private _afterCycle(commits: boolean): void {
        // Nodes whose computation a throw ended without them: no longer computing.
        while (cycleNodes.length !== 0 && (cycleNodes[cycleNodes.length - 1]._flags & RUNNING) === 0) {
            if (cycleNodes.pop() === this) return;
        }
        if (commits && cycleNodes.length !== 0) this._flags |= OUTDATED | RETRY;
    }

    /** `fresh`: a computation from scratch (a new observer); devtools hear its value even if unchanged. */
    private _recompute(fresh: boolean): void {
        const prevContext = evalContext;
        beginTracking(this);
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- the engine's tracking context, not an alias
        evalContext = this;
        let value: T;
        try {
            value = this._fn();
        } catch (error) {
            evalContext = prevContext;
            endTracking(this);
            // The same error again is no new state: dependents are not woken.
            if ((this._flags & HAS_ERROR) === 0 || !Object.is(error, this._error) || this._version === 0) {
                this._error = error;
                this._flags |= HAS_ERROR;
                this._version++;
                if ((this._flags & REPORTS_STATE) !== 0) this._onNewState();
            }
            return;
        }
        evalContext = prevContext;
        endTracking(this);
        const flags = this._flags;
        if ((flags & HAS_VALUE) !== 0) {
            const previous = this._value as T;
            if (Object.is(previous, value) || (this._equals !== undefined && this._isEqual(previous, value))) {
                // Unchanged: a recovery from an error to the same value is still news.
                if ((flags & HAS_ERROR) === 0) {
                    if (fresh && (flags & REPORTS_STATE) !== 0) this._onNewState();
                    return;
                }
                value = previous;
            }
        }
        this._value = value;
        this._version++;
        if ((flags & (HAS_VALUE | HAS_ERROR | REPORTS_STATE)) !== HAS_VALUE) this._settleState(flags);
    }

    /** The rare part of a new value: first value, recovery from an error, devtools. */
    private _settleState(flags: number): void {
        this._error = undefined;
        this._flags = (this._flags & ~HAS_ERROR) | HAS_VALUE;
        if ((flags & REPORTS_STATE) !== 0) this._onNewState();
    }

    private _isEqual(previous: T, next: T): boolean {
        const equals = this._equals!;
        try {
            // Reads inside `equals` are no dependencies of this computed.
            return untracked(() => equals(previous, next));
        } catch (error) {
            console.error(`[rx-toolkit] equals of computed "${this._key}" threw; falling back to Object.is.`, error);
            return Object.is(previous, next);
        }
    }

    /** A new value or error was computed (devtools hook). */
    _onNewState(): void {}

    _notify(): void {
        if ((this._flags & NOTIFIED) === 0) {
            this._flags |= OUTDATED | NOTIFIED;
            for (let link = this._targets; link !== undefined; link = link._nextTarget) {
                link._target._notify();
            }
        }
    }

    override _onObserved(): void {
        // A disposed computed stays cold: its dependents are never woken through it.
        if ((this._flags & DISPOSED) !== 0) return;
        this._flags |= OUTDATED | TRACKING | RETRY;
        for (let link = this._sources; link !== undefined; link = link._nextSource) {
            link._source._subscribe(link);
        }
    }

    override _onUnobserved(): void {
        if ((this._flags & TRACKING) === 0) return;
        this._flags &= ~TRACKING;
        for (let link = this._sources; link !== undefined; link = link._nextSource) {
            link._source._unsubscribe(link);
        }
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

    /** Reads for an `.obs` delivery: never drains (the caller is the queue). */
    _readForDelivery(): T {
        this._refresh();
        if ((this._flags & HAS_ERROR) !== 0) throw this._error;
        return this._value as T;
    }

    _deliverable(): number {
        return (this._flags & HAS_ERROR) !== 0 ? DELIVER_ERROR : DELIVER_VALUE;
    }

    /**
     * Stops the computed: completes the `.obs` subscribers, lets its sources go
     * (nothing wakes it or its dependents any more) and drops the cache. Reads
     * still compute, cold (a recompute to the same value is still no change).
     */
    _disposeNode(): void {
        if ((this._flags & DISPOSED) !== 0) return;
        this._flags |= DISPOSED | OUTDATED | RETRY;
        this._watcher?._dispose();
        if ((this._flags & TRACKING) !== 0) {
            this._flags &= ~TRACKING;
            for (let link = this._sources; link !== undefined; link = link._nextSource) unsubscribeQuietly(link);
        }
    }
}
Object.defineProperty(ComputedNode.prototype, "_kind", { value: KIND_COMPUTED, writable: true });

/**
 * The running computeds from `from` down to the evaluating one. Each running
 * computed is refreshing one of its sources, so the path follows source links
 * through running nodes.
 */
function runningPath(from: Producer, to: Consumer | undefined): Producer[] {
    const path: Producer[] = [from];
    const seen = new Set<Producer>([from]);
    const walk = (node: Producer): boolean => {
        if ((node as unknown) === to) return true;
        if (node._kind !== KIND_COMPUTED) return false;
        for (let link = (node as ComputedNode<unknown>)._sources; link !== undefined; link = link._nextSource) {
            const source = link._source;
            if ((source._flags & RUNNING) === 0 || seen.has(source)) continue;
            seen.add(source);
            path.push(source);
            if (walk(source)) return true;
            path.pop();
        }
        return false;
    };
    return walk(from) ? path : [from];
}

function cycleError(node: Producer): SignalCycleError {
    const chain = runningPath(node, evalContext).map((n) => n._label());
    chain.push(node._label());
    return new SignalCycleError(chain);
}

/** Cycle error for a receiver read while it connects. */
export function receiverCycleError(node: Producer): SignalCycleError {
    const reader = evalContext instanceof ComputedNode ? [evalContext._label()] : [];
    return new SignalCycleError([node._label(), ...reader, node._label()]);
}

// ==================== Effect ====================

type EffectFn = () => void | (() => void);

export class EffectNode implements Evaluator {
    _flags = TRACKING;
    _sources: Link | undefined = undefined;
    _depsTail: Link | undefined = undefined;
    _byMarks = false;
    _nextQueued: EffectNode | undefined = undefined;
    /** Generation of the queued run (see CYCLE_LIMIT). */
    _gen = 0;
    closed = false;
    private _teardown: (() => void) | undefined = undefined;

    constructor(private readonly _fn: EffectFn) {
        // The first run is not a batch of its own: its writes flush at once,
        // while the body still runs (so their echo to this effect is dropped).
        try {
            this._execute(false);
        } catch (error) {
            // The caller has no handle to unsubscribe yet: an effect whose first run throws is released.
            try {
                this.unsubscribe();
            } catch {
                // the run's error is the one to surface
            }
            throw error;
        }
    }

    _notify(): void {
        const flags = this._flags;
        if ((flags & (RUNNING | NOTIFIED)) === 0) {
            this._flags = flags | NOTIFIED;
            enqueueEffect(this);
        } else if ((flags & RUNNING) !== 0) {
            // A write of the running body: sorted out when the run ends.
            this._flags = flags | NOTIFIED_WHILE_RUNNING;
        }
    }

    /** A queued re-run: runs the body if a source changed. */
    _run(): void {
        this._flags &= ~NOTIFIED;
        if ((this._flags & DISPOSED) !== 0) return;
        try {
            if (!needsToRecompute(this)) return;
            this._execute(true);
        } catch (error) {
            failBatch(error);
        }
    }

    /**
     * One run: the previous teardown, then the body under tracking. A throwing
     * body keeps the sources it read before the throw; a throwing teardown
     * surfaces after the run.
     */
    private _execute(rerun: boolean): void {
        let teardownError: { error: unknown } | null = null;
        try {
            this._callTeardown();
        } catch (error) {
            teardownError = { error };
        }
        if ((this._flags & DISPOSED) !== 0) {
            if (teardownError) throw teardownError.error;
            return;
        }

        const prevContext = evalContext;
        beginTracking(this);
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- the engine's tracking context, not an alias
        evalContext = this;
        this._flags |= RUNNING;
        this._flags &= ~NOTIFIED_WHILE_RUNNING;
        let result: void | (() => void) = undefined;
        let bodyError: { error: unknown } | null = null;
        try {
            result = this._fn();
        } catch (error) {
            bodyError = { error };
        }
        evalContext = prevContext;
        this._flags &= ~RUNNING;
        endTracking(this);

        if ((this._flags & DISPOSED) !== 0) {
            // The body unsubscribed its own effect: later reads are no dependencies.
            unlinkSources(this);
            this._depsTail = undefined;
            if (typeof result === "function") {
                try {
                    result();
                } catch (error) {
                    teardownError ??= { error };
                }
            }
        } else {
            if (typeof result === "function") this._teardown = result;
            if ((this._flags & NOTIFIED_WHILE_RUNNING) !== 0) this._settleSources(rerun);
        }
        this._flags &= ~NOTIFIED_WHILE_RUNNING;

        if (teardownError) throw teardownError.error;
        if (bodyError) throw bodyError.error;
    }

    /**
     * The body's own write notified it: bring its sources up to date so
     * their NOTIFIED marks clear and the next write reaches it again. A write
     * to a source it read directly is ignored. In a re-run (inside a flush),
     * one that changed a computed it read queues the next run, or the effect
     * would keep the computed's old value; the first run drops that echo too.
     */
    private _settleSources(rerun: boolean): void {
        let changed = false;
        for (let link = this._sources; link !== undefined; link = link._nextSource) {
            const source = link._source;
            source._refresh();
            if (source._kind === KIND_COMPUTED && source._version !== link._version) changed = true;
        }
        if (changed && rerun && (this._flags & NOTIFIED) === 0) {
            this._flags |= NOTIFIED;
            enqueueEffect(this);
        }
    }

    unsubscribe(): void {
        if (this.closed) return;
        this.closed = true;
        this._flags |= DISPOSED;
        if ((this._flags & RUNNING) !== 0) return;
        try {
            this._callTeardown();
        } finally {
            unlinkSources(this);
            this._depsTail = undefined;
        }
    }

    // Cleared before the call: a teardown runs at most once, even if it throws.
    // It belongs to no consumer's tracking, whoever disposed the effect.
    private _callTeardown(): void {
        const teardown = this._teardown;
        if (!teardown) return;
        this._teardown = undefined;
        const prevContext = evalContext;
        evalContext = undefined;
        try {
            teardown();
        } finally {
            evalContext = prevContext;
        }
    }
}

// ==================== .obs ====================

/** One `.obs` subscriber of a node. */
export class ObsRec {
    last: unknown = NONE;
    closed = false;
    /** State `.obs`: the version whose value it got on subscribe; a queued write of it or older is not its. */
    since = 0;
    /**
     * Part of a receiver's upstream: made while a receiver connects, or inside
     * the delivery of such a subscription (a switchMap inner). Its deliveries
     * are a bridge's writes, the others are writes of user code.
     */
    bridge = false;
    /** Hints: receivers this subscription was seen feeding. */
    feeds: Set<ReceiverLike> | null = null;
    /** The delivery during which this subscription was made (switchMap inner). */
    parent: ObsRec | null = null;
    /** Last receiver hinted, a fast path for repeated writes. */
    lastFed: ReceiverLike | null = null;

    constructor(
        readonly node: Producer,
        readonly subscriber: Subscriber<any>,
    ) {}
}

/**
 * The `.obs` subscribers of one node, each group in subscription order.
 * Bridges are delivered first: they bring receivers up to date, and a
 * subscriber of the others that reads such a receiver reads it current.
 */
export class RecList {
    readonly bridges: ObsRec[] = [];
    readonly others: ObsRec[] = [];
    /** Deliveries iterating the lists: removals compact after them. */
    delivering = 0;
    private _dirty = false;

    get size(): number {
        return this.bridges.length + this.others.length;
    }

    add(rec: ObsRec): void {
        (rec.bridge ? this.bridges : this.others).push(rec);
    }

    has(rec: ObsRec): boolean {
        return (rec.bridge ? this.bridges : this.others).includes(rec);
    }

    /** Returns how many subscribers are left, or -1 while a delivery defers the compaction. */
    remove(rec: ObsRec): number {
        closeRec(rec);
        this._dirty = true;
        return this.delivering === 0 ? this.compact() : -1;
    }

    /** Ends one delivery; after the last, compacts if a subscriber left meanwhile (see `remove`). */
    endDelivery(): number {
        return --this.delivering === 0 && this._dirty ? this.compact() : -1;
    }

    /** Drops closed subscribers; returns how many are left. */
    compact(): number {
        this._dirty = false;
        return compactList(this.bridges) + compactList(this.others);
    }

    /** Empties the lists; returns their subscribers, bridges first. */
    takeAll(): ObsRec[] {
        const all = this.bridges.concat(this.others);
        this.bridges.length = 0;
        this.others.length = 0;
        this._dirty = false;
        return all;
    }
}

/** Delivers the State writes waiting in `stateQueue`; writes made meanwhile join it. */
function drainStateQueue(): void {
    const writer = generation;
    try {
        while (stateHead < stateTail) {
            const item = stateQueue[stateHead]!;
            stateQueue[stateHead++] = null;
            checkGeneration(item.gen);
            generation = item.gen;
            if (item.version === -1) item.node._finishRecs();
            else item.node._deliverQueued(item.value, item.version);
        }
    } finally {
        // An abandoned flush leaves writes behind: they are dropped with it.
        for (let i = stateHead; i < stateTail; i++) stateQueue[i] = null;
        stateHead = stateTail = 0;
        generation = writer;
    }
}

/** A State delivery; a subscriber RxJS does not guard (a raw `Subscriber`) that throws is a failed reaction. */
function deliverGuarded(rec: ObsRec, value: unknown): void {
    if (rec.closed) return;
    try {
        deliverTo(rec, value, NONE);
    } catch (error) {
        failBatch(error);
    }
}

function compactList(list: ObsRec[]): number {
    let j = 0;
    for (let i = 0; i < list.length; i++) if (!list[i].closed) list[j++] = list[i];
    list.length = j;
    return j;
}

function closeRec(rec: ObsRec): void {
    rec.closed = true;
    if (rec.feeds !== null) {
        for (const receiver of rec.feeds) if (receiver._feeders?.delete(rec)) countFeedEdge(rec.node, -1);
        rec.feeds = null;
        gateEpoch++;
    }
}

/** A subscription made inside a delivery inherits its hints; inside a connect it feeds that receiver. */
function linkRecContext(rec: ObsRec): void {
    const top = frameDepth !== 0 ? frameStack[frameDepth - 1] : undefined;
    if (top === undefined) return;
    if (top instanceof ObsRec) {
        rec.parent = top;
        rec.bridge = top.bridge;
        if (top.feeds !== null) for (const receiver of top.feeds) addHint(rec, receiver);
    } else {
        rec.bridge = true;
        addHint(rec, top);
    }
}

function addHint(rec: ObsRec, receiver: ReceiverLike): void {
    const feeders = (receiver._feeders ??= new Set());
    if (feeders.has(rec)) return;
    feeders.add(rec);
    (rec.feeds ??= new Set()).add(receiver);
    countFeedEdge(rec.node, 1);
    gateEpoch++;
}

/** Hint edges per node their subscriptions start from: the nodes a hint can name as a feeder. */
const feedEdges = new Map<Producer, number>();

function countFeedEdge(node: Producer, delta: 1 | -1): void {
    const n = (feedEdges.get(node) ?? 0) + delta;
    if (n === 0) feedEdges.delete(node);
    else feedEdges.set(node, n);
}

/** A write of `receiver` during the current delivery: hint edges from it and its creators. */
export function hintWrite(receiver: ReceiverLike): ObsRec | null {
    const top = frameDepth !== 0 ? frameStack[frameDepth - 1] : undefined;
    if (!(top instanceof ObsRec)) return null;
    if (top.lastFed !== receiver) {
        top.lastFed = receiver;
        for (let rec: ObsRec | null = top; rec !== null; rec = rec.parent) addHint(rec, receiver);
    }
    return top;
}

/** Completes one `.obs` subscriber, as a delivery (outside any consumer's tracking). */
function completeTo(rec: ObsRec): void {
    frameStack[frameDepth++] = rec;
    deliveryDepth++;
    const prevContext = evalContext;
    evalContext = undefined;
    try {
        closeRec(rec);
        rec.subscriber.complete();
    } finally {
        evalContext = prevContext;
        frameStack[--frameDepth] = undefined;
        deliveryDepth--;
    }
}

function deliverTo(rec: ObsRec, value: unknown, error: unknown): void {
    frameStack[frameDepth++] = rec;
    deliveryDepth++;
    // An RxJS callback belongs to no consumer, whoever's write triggered it.
    const prevContext = evalContext;
    evalContext = undefined;
    try {
        if (error !== NONE) {
            closeRec(rec);
            rec.subscriber.error(error);
        } else if (!Object.is(rec.last, value)) {
            rec.last = value;
            rec.subscriber.next(value);
        }
    } finally {
        evalContext = prevContext;
        frameStack[--frameDepth] = undefined;
        deliveryDepth--;
    }
}

/** A node `.obs` delivers: the watcher reads it through these. */
export interface WatchableNode<T = unknown> extends Producer {
    _watcher: Watcher | null;
    _readForDelivery(): T;
    /** What `.obs` gets from the node's current state (a receiver that has not emitted: nothing). */
    _deliverable(): number;
    /** Initial value for a new subscriber, by the rules of a read. */
    peek(): T;
}

/** The `.obs` subscribers of one node: a consumer of it, delivered at the flush. */
export class Watcher implements Consumer {
    _flags = TRACKING;
    _sources: Link | undefined = undefined;
    _queued = false;
    /** Generation of the queued delivery (see CYCLE_LIMIT). */
    _gen = 0;
    _dead = false;
    readonly _recs = new RecList();
    private _delivering = false;
    /** The subscription being delivered to. */
    private _current: ObsRec | null = null;
    /** The node changed during the delivery: the rest of it is stale, a new one follows. */
    private _requeue = false;
    /** The node completed: the subscribers complete after the next delivery. */
    private _completing = false;

    constructor(readonly _node: WatchableNode) {}

    _link(): void {
        const link = new Link(this._node, this, this._node._version, undefined, undefined);
        this._sources = link;
        this._node._subscribe(link);
    }

    _notify(): void {
        if (this._delivering) {
            this._requeue = true;
            // A bridge fed by our own delivery wrote a receiver our node depends
            // on: a synchronous cycle. A write of user code (a subscriber
            // pushing into a Subject) is a new write, delivered next.
            // eslint-disable-next-line @typescript-eslint/no-this-alias -- reported to the write that closed the cycle
            if (this._current?.bridge) cycleWatcher = this;
            return;
        }
        if (!this._queued) {
            this._queued = true;
            enqueueWatcher(this);
        } else {
            // A pending node changed.
            gateEpoch++;
        }
    }

    _deliver(): void {
        this._queued = false;
        if (this._dead) return;
        this._deliverValue();
        if (this._completing && !this._dead) this._finish();
    }

    private _deliverValue(): void {
        const node = this._node;
        let value: unknown;
        let error: unknown = NONE;
        try {
            value = node._readForDelivery();
        } catch (caught) {
            error = caught;
        }
        const deliverable = node._deliverable();
        if (deliverable === DELIVER_NOTHING) return;
        if (error === NONE && deliverable === DELIVER_ERROR) return;
        this._delivering = true;
        const recs = this._recs;
        recs.delivering++;
        try {
            if (this._deliverList(recs.bridges, value, error)) this._deliverList(recs.others, value, error);
        } finally {
            this._delivering = false;
            this._current = null;
            if (recs.endDelivery() === 0) this._unlink();
        }
        if (this._requeue) {
            this._requeue = false;
            if (!this._dead) this._notify();
        }
    }

    /** Returns false once the node changed during the delivery; an error still reaches everyone. */
    private _deliverList(list: ObsRec[], value: unknown, error: unknown): boolean {
        const n = list.length;
        for (let i = 0; i < n; i++) {
            if (this._requeue && error === NONE) return false;
            const rec = list[i];
            if (rec.closed) continue;
            this._current = rec;
            deliverTo(rec, value, error);
        }
        return !this._requeue || error !== NONE;
    }

    /**
     * The node's upstream completed: the subscribers get the pending value
     * (if any), then complete — from the queue, so the order of a flush holds.
     */
    _complete(): void {
        this._completing = true;
        // A delivery running or pending completes them when it is done.
        if (this._delivering || this._queued) return;
        this._queued = true;
        batchDepth++;
        try {
            enqueueWatcher(this);
        } finally {
            endBatch();
        }
    }

    /** Completes every subscriber; a later one starts a new watcher. */
    private _finish(): void {
        this._completing = false;
        const recs = this._recs.takeAll();
        this._unlink();
        for (const rec of recs) if (!rec.closed) completeTo(rec);
    }

    _remove(rec: ObsRec): void {
        if (rec.closed && !this._recs.has(rec)) return;
        if (this._recs.remove(rec) === 0) this._unlink();
    }

    private _unlink(): void {
        if (this._dead) return;
        this._dead = true;
        if (this._node._watcher === this) this._node._watcher = null;
        unlinkSources(this);
    }

    /** The node is disposed: the subscribers get the value a running or pending delivery brings, then complete. */
    _dispose(): void {
        if (this._delivering || this._queued) this._completing = true;
        else this._finish();
    }
}

/** `.obs` subscription of a queued-delivery node (computed, receiver). */
export function watch<T>(node: WatchableNode<T>, subscriber: Subscriber<T>): TeardownLogic {
    // Work the subscription triggers (an upstream connecting, a subscriber
    // writing) flushes after it; an error of that flush belongs to no subscriber.
    batchDepth++;
    try {
        return watchInBatch(node, subscriber);
    } finally {
        try {
            endBatch();
        } catch (error) {
            reportUnhandled(error);
        }
    }
}

function watchInBatch<T>(node: WatchableNode<T>, subscriber: Subscriber<T>): TeardownLogic {
    let watcher = node._watcher;
    if (watcher === null) {
        watcher = node._watcher = new Watcher(node);
    }
    const rec = new ObsRec(node, subscriber);
    linkRecContext(rec);
    watcher._recs.add(rec);
    const owner = watcher;
    if (watcher._recs.size === 1) {
        try {
            watcher._link();
        } catch (error) {
            // The node refused its first observer: RxJS hands the error to the
            // subscriber and never calls a teardown, so nothing may stay registered.
            owner._remove(rec);
            throw error;
        }
    }
    if ((node._flags & RUNNING) !== 0) {
        // Subscribed while the node computes (a receiver connecting inside its
        // computation): it has no value to read yet. The first value comes
        // from the queue once the computation is done.
        watcher._notify();
        deferredFlush = true;
        settlePending = true;
        return () => owner._remove(rec);
    }
    // The current value, by the rules of a read.
    let value: unknown;
    let error: unknown = NONE;
    try {
        value = node.peek();
    } catch (caught) {
        error = caught;
    }
    if (!rec.closed) {
        const deliverable = node._deliverable();
        if (error !== NONE) {
            if (deliverable !== DELIVER_NOTHING) deliverTo(rec, value, error);
        } else if (deliverable !== DELIVER_NOTHING) {
            // A computed read inside a batch may hold a value its committed state has not yet.
            deliverTo(rec, value, NONE);
        }
    }
    // A completed node that is still retained: its value, then complete.
    if (!rec.closed && (node._flags & COMPLETED) !== 0) owner._complete();
    return () => owner._remove(rec);
}

// ==================== Receivers (the part of Signal.from the gate needs) ====================

/** A node an RxJS callback writes: `Signal.from`, `SourceSignal.create`. */
export interface ReceiverLike extends Producer {
    _feeders: Set<ObsRec> | null;
    /** The receiver's own receiver set: itself. */
    readonly _receivers: readonly ReceiverLike[];
    /** Gate stamp and counter for the intersection of receiver sets. */
    _gateStamp: number;
    _gateCount: number;
    _releaseAfterRead(): void;
}

/** A receiver's upstream subscription went live / ended. */
export function receiverLive(delta: 1 | -1): void {
    connectedReceivers += delta;
    gateEpoch++;
}

/** Drops the hints into a receiver (its upstream is gone). */
export function dropFeeders(receiver: ReceiverLike): void {
    const feeders = receiver._feeders;
    if (feeders === null) return;
    receiver._feeders = null;
    for (const rec of feeders) if (rec.feeds?.delete(receiver)) countFeedEdge(rec.node, -1);
    gateEpoch++;
}

/** Brackets a receiver's subscribe to its upstream. */
export function enterConnect(receiver: ReceiverLike): void {
    frameStack[frameDepth++] = receiver;
    connectDepth++;
}

export function leaveConnect(): void {
    frameStack[--frameDepth] = undefined;
    connectDepth--;
}

export function queueRelease(receiver: ReceiverLike): void {
    releaseQueue.push(receiver);
    settlePending = true;
}

export function isInsideRead(): boolean {
    return runningDepth !== 0 || connectDepth !== 0;
}

/**
 * A producer's value (or error) changed: bump versions, mark dependents and
 * flush when nothing encloses the write (errors of that flush propagate).
 * Returns the watcher whose own delivery the write fed back into (a
 * synchronous cycle through a bridge), or null.
 */
export function writeProducer(node: Producer): Watcher | null {
    node._version++;
    globalVersion++;
    batchDepth++;
    cycleWatcher = null;
    let cycle: Watcher | null = null;
    try {
        for (let link = node._targets; link !== undefined; link = link._nextTarget) {
            link._target._notify();
        }
        cycle = cycleWatcher;
        cycleWatcher = null;
    } finally {
        endBatch();
    }
    return cycle;
}

/** Bumps a producer's version without notifying (a change nobody observes). */
export function bumpVersion(node: Producer): void {
    node._version++;
    globalVersion++;
}

/**
 * A producer stopped hearing about its changes (a receiver let its upstream
 * go): from now on its value can change with no write. A computed validated
 * before this may no longer trust its cache by the global version alone.
 */
export function stopWatchingChanges(): void {
    globalVersion++;
}

/** Waits for the next change of `node` after `version`, then calls `onChange` from the watcher queue. */
export class RecoveryWatcher extends Watcher {
    constructor(
        node: WatchableNode,
        private readonly _seen: number,
        private readonly _onChange: () => void,
    ) {
        super(node);
        this._link();
    }

    override _notify(): void {
        if (this._queued) {
            gateEpoch++;
        } else if (!this._dead) {
            this._queued = true;
            enqueueWatcher(this);
        }
    }

    override _deliver(): void {
        this._queued = false;
        if (this._dead) return;
        try {
            this._node._refresh();
        } catch {
            // an error state is a version like any other
        }
        if (this._node._version === this._seen) return;
        this._stop();
        this._onChange();
    }

    _stop(): void {
        if (this._dead) return;
        this._dead = true;
        unlinkSources(this);
    }
}

// ==================== The delivery gate ====================

/** Receivers `node` depends on through its current links (a receiver: itself). */
function receiversOf(producer: Producer): readonly ReceiverLike[] {
    const kind = producer._kind;
    if (kind === KIND_RECEIVER) return (producer as ReceiverLike)._receivers;
    if (kind !== KIND_COMPUTED) return EMPTY_RECEIVERS;
    const node = producer as ComputedNode<unknown>;
    if (node._rEpoch === structureEpoch) return node._receivers;
    node._rEpoch = structureEpoch;
    let acc: readonly ReceiverLike[] = EMPTY_RECEIVERS;
    let owned: ReceiverLike[] | null = null;
    for (let link = node._sources; link !== undefined; link = link._nextSource) {
        const r = receiversOf(link._source);
        if (r.length === 0 || r === acc) continue;
        if (acc.length === 0) {
            acc = r;
            continue;
        }
        if (owned === null) {
            owned = acc.slice();
            acc = owned;
        }
        for (const t of r) if (!owned.includes(t)) owned.push(t);
    }
    node._receivers = acc;
    return acc;
}

let gateStamp = 0;

/**
 * One round of the delivery gate. A watcher is delivered when no other
 * pending watcher can write a receiver its node depends on without forming a
 * cycle: its receiver set is inside the intersection of all pending sets.
 * Without such a watcher, hints (known bridge edges) decide, then queue order.
 *
 * A delivery that changed nothing the decision reads (no watcher queued or
 * marked, no link, hint or connection changed) leaves the next round the same
 * graph minus the delivered watchers: that round is decided here from the
 * counts already taken, so k pending watchers cost O(k) instead of k rounds
 * of O(k) when no watcher can be proven safe ahead of the others.
 */
function gateRound(): void {
    gateEpoch++;
    if (connectedReceivers === 0 || watchTail - watchHead === 1) {
        // No bridge can reorder anything: deliver the pending generation in
        // queue order (watchers it queues form the next round).
        const end = watchTail;
        while (watchHead < end) {
            const watcher = watchQueue[watchHead];
            if (watcher === null) {
                watchHead++;
                continue;
            }
            checkGeneration(watcher._gen);
            watchQueue[watchHead++] = null;
            generation = watcher._gen;
            watcher._deliver();
        }
        if (watchHead === watchTail) watchHead = watchTail = 0;
        return;
    }

    const live: Watcher[] = [];
    for (let i = watchHead; i < watchTail; i++) {
        const w = watchQueue[i];
        if (w === null) continue;
        watchQueue[i] = null;
        if (!w._dead && w._queued) live.push(w);
        else w._queued = false;
    }
    watchHead = watchTail = 0;
    if (live.length === 0) return;

    // Tentative values: brings every pending node (and so its links) up to date.
    const epochBefore = gateEpoch;
    for (const w of live) {
        if (w._node._kind !== KIND_COMPUTED) continue;
        try {
            w._node._refresh();
        } catch {
            // an error is delivered as such
        }
    }

    // Watchers the refresh queued go first, then the pending ones in order.
    const round = new GateRound(live, watchTail);
    // Later rounds are decided here only while the graph stays as it was
    // since the refresh: a node it marked again needs another refresh.
    let epoch = round._base === 0 && gateEpoch === epochBefore ? gateEpoch : -1;
    let structure = structureEpoch;
    try {
        for (;;) {
            const n = round._choose();
            const chosen = round._chosen;
            for (let c = 0; c < n; c++) checkGeneration(live[chosen[c]]._gen);
            for (let c = 0; c < n; c++) round._remove(chosen[c]);
            for (let c = 0; c < n; c++) {
                const watcher = live[chosen[c]];
                generation = watcher._gen;
                watcher._deliver();
            }
            if (round._left === 0 || epoch !== gateEpoch || structure !== structureEpoch) break;
            epoch = gateEpoch;
            structure = structureEpoch;
        }
    } finally {
        // Delivered watchers left holes in their slots.
        if (round._left === 0 && epoch === gateEpoch) {
            // All delivered, nothing queued since: the holes are the tail.
            watchTail = round._base;
        } else {
            let j = watchHead;
            for (let i = watchHead; i < watchTail; i++) {
                const w = watchQueue[i];
                if (w === null) continue;
                watchQueue[i] = null;
                watchQueue[j++] = w;
            }
            watchTail = j;
        }
        if (watchHead === watchTail) watchHead = watchTail = 0;
    }
}

/**
 * The pending watchers of one gate round as they are delivered. Slot `i` is
 * `live[i]`, queued at `_base + i`; a delivered one leaves a hole there.
 */
class GateRound {
    _left: number;
    /** The slots `_choose` picked (a prefix). */
    readonly _chosen: number[] = [];
    /** The first slot not delivered yet. */
    private _first = 0;
    /** Receiver set per slot. */
    private readonly _sets: (readonly ReceiverLike[])[] = [];
    private _minSize = Infinity;
    /**
     * With sets of one size and no pending node known to feed a receiver, the
     * rounds reduce to queue order: one watcher per round until the pending
     * sets are all the same, then all of them. This is the slot from which
     * they are; -1 when the rounds are decided from counts.
     */
    private _sameFrom = -1;
    /** Slots by receiver-set size (stable), once a watcher left and the sizes differ. */
    private _bySize: number[] | null = null;
    private _sizeAt = 0;
    /** Pending watchers per node that feeds a receiver (hints); built on first use. */
    private _pending: Map<Producer, number> | null = null;

    constructor(
        private readonly _live: Watcher[],
        readonly _base: number,
    ) {
        this._left = _live.length;
        const sets = this._sets;
        let same = true;
        let uniform = true;
        for (let i = 0; i < _live.length; i++) {
            const w = _live[i];
            watchQueue[watchTail++] = w;
            const r = receiversOf(w._node);
            if (i !== 0) {
                if (r !== sets[0]) same = false;
                if (r.length !== sets[0].length) uniform = false;
            }
            if (r.length < this._minSize) this._minSize = r.length;
            sets.push(r);
        }
        if (same) {
            this._sameFrom = 0;
            return;
        }
        if (uniform && !this._anyPendingFeeds()) {
            this._sameFrom = this._sameSuffix();
            return;
        }
        // How many pending watchers depend on each receiver.
        const stamp = ++gateStamp;
        for (const r of sets) {
            for (let j = 0; j < r.length; j++) {
                const t = r[j];
                if (t._gateStamp !== stamp) {
                    t._gateStamp = stamp;
                    t._gateCount = 1;
                } else {
                    t._gateCount++;
                }
            }
        }
    }

    /** Picks the slots to deliver now into `_chosen`, in queue order; returns how many. */
    _choose(): number {
        const base = this._base;
        let first = this._first;
        while (watchQueue[base + first] === null) first++;
        this._first = first;
        // Every pending set contains the intersection, so a set inside it is
        // the intersection itself, one of the smallest sets. One smallest set
        // decides for all: if it is the intersection, so is every set of its size.
        const sets = this._sets;
        const chosen = this._chosen;
        let n = 0;
        if (this._sameFrom !== -1) {
            if (first < this._sameFrom) {
                chosen[0] = first;
                return 1;
            }
            for (let i = first; i < sets.length; i++) if (watchQueue[base + i] !== null) chosen[n++] = i;
            return n;
        }
        if (this._left === sets.length) {
            const size = this._minSize;
            for (let i = first; i < sets.length; i++) {
                if (sets[i].length !== size || watchQueue[base + i] === null) continue;
                if (n === 0 && !this._isIntersection(i)) break;
                chosen[n++] = i;
            }
        } else {
            const bySize = (this._bySize ??= this._sortBySize());
            let p = this._sizeAt;
            while (watchQueue[base + bySize[p]] === null) p++;
            this._sizeAt = p;
            const size = sets[bySize[p]].length;
            for (; p < bySize.length; p++) {
                const i = bySize[p];
                if (watchQueue[base + i] === null) continue;
                if (sets[i].length !== size) break;
                if (n === 0 && !this._isIntersection(i)) break;
                chosen[n++] = i;
            }
        }
        if (n === 0) chosen[n++] = this._byHints();
        return n;
    }

    _remove(i: number): void {
        watchQueue[this._base + i] = null;
        this._left--;
        if (this._sameFrom !== -1) return;
        const r = this._sets[i];
        for (let j = 0; j < r.length; j++) r[j]._gateCount--;
        const pending = this._pending;
        if (pending !== null && pending.size !== 0) {
            const node = this._live[i]._node;
            const count = pending.get(node);
            if (count === 1) pending.delete(node);
            else if (count !== undefined) pending.set(node, count - 1);
        }
    }

    private _anyPendingFeeds(): boolean {
        if (feedEdges.size === 0) return false;
        for (const w of this._live) if (feedEdges.has(w._node)) return true;
        return false;
    }

    /** The first slot of the longest run of equal sets that ends the queue (sets of one size). */
    private _sameSuffix(): number {
        const sets = this._sets;
        const last = sets[sets.length - 1];
        const stamp = ++gateStamp;
        for (const t of last) t._gateStamp = stamp;
        let from = sets.length - 1;
        outer: while (from > 0) {
            const r = sets[from - 1];
            if (r !== last) for (const t of r) if (t._gateStamp !== stamp) break outer;
            from--;
        }
        return from;
    }

    private _isIntersection(i: number): boolean {
        const r = this._sets[i];
        for (let j = 0; j < r.length; j++) if (r[j]._gateCount !== this._left) return false;
        return true;
    }

    private _sortBySize(): number[] {
        const sets = this._sets;
        const bySize: number[] = [];
        for (let i = this._first; i < sets.length; i++) if (watchQueue[this._base + i] !== null) bySize.push(i);
        return bySize.sort((a, b) => sets[a].length - sets[b].length);
    }

    /** The first pending slot no other pending watcher is known to feed (through hints), else the first. */
    private _byHints(): number {
        const live = this._live;
        const base = this._base;
        let pending = this._pending;
        if (pending === null) {
            // Only a node a hint edge starts from can block.
            pending = this._pending = new Map();
            for (let i = this._first; i < live.length; i++) {
                if (watchQueue[base + i] === null) continue;
                const node = live[i]._node;
                if (feedEdges.has(node)) pending.set(node, (pending.get(node) ?? 0) + 1);
            }
        }
        if (pending.size === 0) return this._first;
        for (let i = this._first; i < live.length; i++) {
            if (watchQueue[base + i] === null) continue;
            const node = live[i]._node;
            visited.clear();
            const blocked = fedByPending(node, node, pending);
            visited.clear();
            if (!blocked) return i;
        }
        return this._first;
    }
}

/** Nodes one `fedByPending` search has seen (no user code runs during it). */
const visited = new Set<Producer>();

/** Whether a pending node other than `start` is known (through hints) to feed `node`. */
function fedByPending(node: Producer, start: Producer, pending: Map<Producer, number>): boolean {
    if (visited.has(node)) return false;
    visited.add(node);
    if (node._kind === KIND_RECEIVER) {
        const feeders = (node as ReceiverLike)._feeders;
        if (feeders !== null) {
            for (const rec of feeders) {
                if (rec.node !== start && pending.has(rec.node)) return true;
                if (fedByPending(rec.node, start, pending)) return true;
            }
        }
    } else if (node._kind === KIND_COMPUTED) {
        for (let link = (node as ComputedNode<unknown>)._sources; link !== undefined; link = link._nextSource) {
            if (fedByPending(link._source, start, pending)) return true;
        }
    }
    return false;
}
