import { MAX_TIMEOUT_DELAY } from "@/common/utils";
import type { TInvalidateOnOptions } from "@/query/types";

import type { QueryCacheEntry } from "../cache/QueryCacheEntry";
import { buildEntryState } from "../resource/entry-state";

import type { EnvironmentMonitor } from "./EnvironmentMonitor";

interface IIntervalClockOptions<TArgs, TData> {
    args: TArgs;
    entry: QueryCacheEntry<TArgs, TData>;
    interval: TInvalidateOnOptions<TArgs, TData>["interval"];
    environment: EnvironmentMonitor;
    onFire: () => void;
}

/**
 * Owns one entry's poll deadline without holding the entry itself. Re-arming
 * follows entry activity and environment changes, so slow requests never
 * overlap and melting entries remain governed only by cache retention.
 */
export class IntervalClock<TArgs, TData> {
    private _lastLeftFlightAt = Date.now();
    private _timer: ReturnType<typeof setTimeout> | null = null;
    private _wasInFlight: boolean;

    constructor(private readonly _options: IIntervalClockOptions<TArgs, TData>) {
        this._wasInFlight = _options.entry._isInFlight;
    }

    update(): void {
        this._captureFlightTransition();
        if (!this._isEligible()) {
            this._clear();
            return;
        }

        const interval = this._resolveInterval();
        if (interval === null) {
            this._clear();
            return;
        }

        this._clear();
        this._timer = setTimeout(() => this._fire(), Math.max(0, this._lastLeftFlightAt + interval - Date.now()));
    }

    dispose(): void {
        this._clear();
    }

    private _fire(): void {
        this._timer = null;
        this._captureFlightTransition();
        if (!this._isEligible()) {
            this.update();
            return;
        }

        if (this._resolveInterval() === null) return;

        this._options.onFire();
    }

    private _captureFlightTransition(): void {
        const isInFlight = this._options.entry._isInFlight;
        if (this._wasInFlight && !isInFlight) this._lastLeftFlightAt = Date.now();
        this._wasInFlight = isInFlight;
    }

    private _isEligible(): boolean {
        const { entry, environment } = this._options;
        const state = environment.state;
        return !entry.isCompleted && !entry.isMelting && !entry._isInFlight && state.visible && state.online;
    }

    private _resolveInterval(): number | null {
        const { args, entry, interval: configured } = this._options;
        let value: unknown = configured;
        if (typeof configured === "function") {
            try {
                value = configured(args, buildEntryState(args, entry.peek()));
            } catch (error) {
                console.error("[Resource] invalidateOn.interval threw", error);
                return null;
            }
        }

        return normalizeInterval(value);
    }

    private _clear(): void {
        if (this._timer === null) return;
        clearTimeout(this._timer);
        this._timer = null;
    }
}

function normalizeInterval(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_TIMEOUT_DELAY) {
        return null;
    }
    return value;
}
