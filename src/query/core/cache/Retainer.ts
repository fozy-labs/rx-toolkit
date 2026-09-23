import { Observable } from "rxjs";

// ==================== Retainer ====================

export interface TRetainerOptions {
    /**
     * The retention policy, already normalized: the delay in ms before
     * {@link TRetainerOptions.onExpire}, or `null` for "keep forever". Called
     * once per melting cycle, inside the release of the last hold; a throw is
     * caught, logged against {@link TRetainerOptions.key} and read as `0`.
     */
    retentionTime: () => number | null;
    /** Diagnostics label — the entry key — for the policy-threw log line. */
    key: string;
    /**
     * Holds went `0 → 1`. Called before a subscribing consumer is attached to
     * the source, so a state change made here is the first thing it sees.
     */
    onActive: () => void;
    /** Holds went `1 → 0`. Called after the releasing consumer is detached, before the policy runs. */
    onMelting: () => void;
    /** The retention timer fired: the entry has no holds and its retention ran out. */
    onExpire: () => void;
}

/**
 * The single owner of an entry's hold count and retention timer.
 *
 * A hold is what keeps an entry `active`; an entry without holds is `melting`
 * (in retention): the timer armed by {@link TRetainerOptions.retentionTime}
 * evicts it unless a hold comes first. Subscribing to {@link obs} is a hold for
 * the life of the subscription; {@link hold} is the same thing without a data
 * subscription. Knows nothing about the data it guards.
 *
 * An entry is born melting — nobody holds it until someone subscribes — but
 * without a timer: the policy runs on the `active → retention` transition
 * only, so an entry that was never held is never evaluated and never expires.
 * That is what lets a consumer create an entry and hold it in the same tick
 * without racing the timer, and what lets a policy assume that its first
 * evaluation follows a real hold (see `Command.execute`).
 */
export class Retainer<T> {
    private _holds = 0;
    private _timer: ReturnType<typeof setTimeout> | null = null;
    private _isDisposed = false;

    /** The source, held for as long as the subscription lives. */
    readonly obs: Observable<T>;

    constructor(
        private readonly _source: Observable<T>,
        private readonly _opts: TRetainerOptions,
    ) {
        this.obs = new Observable<T>((subscriber) => {
            // Hold first: if `onActive` changes the state synchronously, the
            // subscriber's first value is already the new one.
            const release = this.hold();
            const subscription = this._source.subscribe(subscriber);
            return () => {
                // Detach first: `onMelting` and the policy see the entry
                // without this subscriber.
                subscription.unsubscribe();
                release();
            };
        });
    }

    /** Whether nobody holds the entry — it is in retention. */
    get isMelting(): boolean {
        return this._holds === 0;
    }

    /**
     * Keepalive without a data subscription. The returned release is
     * idempotent; after {@link dispose} both the hold and its release are no-ops.
     */
    hold(): () => void {
        if (this._isDisposed) return () => {};

        this._holds += 1;

        let isReleased = false;
        const release = (): void => {
            if (isReleased || this._isDisposed) return;
            isReleased = true;
            this._holds -= 1;
            if (this._holds === 0) {
                this._opts.onMelting();
                this._arm();
            }
        };

        if (this._holds === 1) {
            this._disarm();
            try {
                this._opts.onActive();
            } catch (error) {
                // The hold is not established: hand the count back so the
                // entry does not stay active with nobody holding it.
                release();
                throw error;
            }
        }

        return release;
    }

    /** Stop the timer for good; every later hold / release is a no-op. */
    dispose(): void {
        this._isDisposed = true;
        this._disarm();
    }

    // ==================== Private ====================

    /** Start one retention cycle: evaluate the policy and arm its timer. */
    private _arm(): void {
        let delay: number | null;
        try {
            delay = this._opts.retentionTime();
        } catch (error) {
            // The policy runs inside a consumer's teardown; its throw must not
            // surface there as an UnsubscriptionError. A failed policy evicts.
            console.error(`[CacheEntry] retentionTime threw for entry "${this._opts.key}"`, error);
            delay = 0;
        }

        if (delay === null) return;

        this._timer = setTimeout(() => {
            this._timer = null;
            this._opts.onExpire();
        }, delay);
    }

    private _disarm(): void {
        if (this._timer === null) return;
        clearTimeout(this._timer);
        this._timer = null;
    }
}
