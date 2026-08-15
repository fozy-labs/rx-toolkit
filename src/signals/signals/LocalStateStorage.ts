import { z } from "zod/v4";

export type StorageLike = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    /** Optional key enumeration — required for the format wipe and GC sweep. */
    keys?(): string[];
    /** Web Storage enumeration fallback (covers the native `localStorage`). */
    length?: number;
    key?(index: number): string | null;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Default GC timings (milliseconds). */
export const LOCAL_STATE_GC_DEFAULTS = {
    /** Max keys processed synchronously per sweep slice; the rest yields via setTimeout. */
    syncLimit: 20,
    /** How often a GC sweep is due. */
    checkInterval: WEEK,
    /** Random spread applied to GC scheduling instead of cross-tab locking. */
    randomOffset: HOUR,
    /** A slot unread/unwritten for this long is removed by the sweep. */
    maxUnreadTime: 60 * DAY,
} as const;

/**
 * Global GC tuning, shared by all drivers. Exposed publicly as
 * `LocalState.GC_OPTIONS` / `LocalSignal.GC_OPTIONS` (same object reference).
 * Values are read at scheduling/sweep time — mutations apply from the next
 * scheduled step, they do not rewind an already pending timer.
 */
export const GC_OPTIONS: {
    syncLimit: number;
    checkInterval: number;
    randomOffset: number;
} = {
    syncLimit: LOCAL_STATE_GC_DEFAULTS.syncLimit,
    checkInterval: LOCAL_STATE_GC_DEFAULTS.checkInterval,
    randomOffset: LOCAL_STATE_GC_DEFAULTS.randomOffset,
};

/**
 * Bumping this invalidates the whole `__LSValue__` namespace: on init any
 * storage whose meta is missing or carries a different version is wiped and
 * re-marked (no backward compatibility by design).
 */
export const STORAGE_VERSION = 1;

export const KEY_PREFIX = "__LSValue__";

/** The bare prefix key holds the package meta for the whole namespace. */
const META_KEY = KEY_PREFIX;
const DATA_KEY_PREFIX = `${KEY_PREFIX}:`;

/** setTimeout clamps delays above 2^31-1 to 0 — clamp and re-check instead. */
const MAX_TIMEOUT = 2147483647;

const metaSchema = z.object({
    v: z.number(),
    nextGcAt: z.number(),
});

/**
 * Per-slot envelope:
 * - `at` — last-touched timestamp (refreshed on read no more than once per
 *   `checkInterval`), the LRU input for the sweep;
 * - `ttl` — `null` = slot is GC-exempt, number = per-slot `maxUnreadTime`,
 *   absent = `LOCAL_STATE_GC_DEFAULTS.maxUnreadTime` applies at sweep time.
 */
const envelopeSchema = z.object({
    at: z.number(),
    ttl: z.number().nullable().optional(),
    data: z.unknown(),
});

type Envelope = z.infer<typeof envelopeSchema>;

export type SlotTtl = number | null | undefined;

export function slotStorageKey(key: string, userId?: string) {
    return userId ? `${DATA_KEY_PREFIX}${key}:user:${userId}` : `${DATA_KEY_PREFIX}${key}`;
}

function jitter(maxAbs: number) {
    return (Math.random() * 2 - 1) * maxAbs;
}

/** Keep a Node process (SSR with a custom driver) from being held by GC timers. */
function unrefSafe(timer: unknown) {
    (timer as { unref?: () => void }).unref?.();
}

/**
 * Per-driver storage manager: owns the namespace meta (`__LSValue__`), the
 * one-time format check/wipe and the lock-free GC scheduling. `LocalState`
 * instances only read/write individual slots through it.
 */
export class LocalStateStorage {
    private static _instances = new WeakMap<StorageLike, LocalStateStorage>();

    static forDriver(driver: StorageLike): LocalStateStorage {
        let instance = LocalStateStorage._instances.get(driver);

        if (!instance) {
            instance = new LocalStateStorage(driver);
            LocalStateStorage._instances.set(driver, instance);
            instance._init();
        }

        return instance;
    }

    private readonly _driver: StorageLike;
    private _gcTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * False when the namespace meta carries a NEWER format version (another
     * tab runs a newer package). In that case this session neither wipes nor
     * garbage-collects nor self-heals entries it cannot parse — it must not
     * destroy data of a format it does not understand.
     */
    private _ownsFormat = true;

    private constructor(driver: StorageLike) {
        this._driver = driver;
    }

    // === slots ===

    readSlot(storageKey: string, ttl: SlotTtl): { found: false } | { found: true; data: unknown } {
        const raw = this._driver.getItem(storageKey);

        if (raw === null) return { found: false };

        const envelope = this._parseEnvelope(raw);

        if (!envelope) {
            console.warn(`[LocalSignal]: corrupted storage entry "${storageKey}" is ignored`);
            // Self-heal: broken entries are useless and would otherwise stay forever.
            if (this._ownsFormat) this._driver.removeItem(storageKey);
            return { found: false };
        }

        // Touch-on-read (throttled to one write per checkInterval): keeps
        // slots that are read but rarely written from expiring under GC.
        if (Date.now() - envelope.at >= GC_OPTIONS.checkInterval) {
            this.writeSlot(storageKey, envelope.data, ttl);
        }

        return { found: true, data: envelope.data };
    }

    writeSlot(storageKey: string, data: unknown, ttl: SlotTtl) {
        const envelope: Envelope = { at: Date.now(), data };

        // `undefined` means "default policy" and is omitted, so changing the
        // default later applies to already stored slots as well.
        if (ttl !== undefined) envelope.ttl = ttl;

        this._driver.setItem(storageKey, JSON.stringify(envelope));
    }

    removeSlot(storageKey: string) {
        this._driver.removeItem(storageKey);
    }

    // === meta / format ===

    /**
     * One-time per driver. Missing/invalid/foreign-version meta means the
     * namespace content is of an unknown format — wipe it and re-mark
     * (intentionally no migration). A NEWER version is left untouched.
     */
    private _init() {
        const meta = this._readMeta();

        if (meta && meta.v === STORAGE_VERSION) {
            this._scheduleGc();
            return;
        }

        if (meta && meta.v > STORAGE_VERSION) {
            this._ownsFormat = false;
            return;
        }

        this._wipe();
        this._writeMeta(Date.now() + GC_OPTIONS.checkInterval + jitter(GC_OPTIONS.randomOffset));
        this._scheduleGc();
    }

    private _readMeta() {
        const raw = this._driver.getItem(META_KEY);

        if (raw === null) return null;

        let json: unknown;

        try {
            json = JSON.parse(raw);
        } catch {
            return null;
        }

        const parsed = metaSchema.safeParse(json);
        return parsed.success ? parsed.data : null;
    }

    private _writeMeta(nextGcAt: number) {
        this._driver.setItem(META_KEY, JSON.stringify({ v: STORAGE_VERSION, nextGcAt }));
    }

    private _wipe() {
        const keys = this._enumerateKeys();

        // No enumeration → cannot wipe; reads self-heal old entries one by one.
        if (!keys) return;

        for (const key of keys) {
            if (key === META_KEY || key.startsWith(DATA_KEY_PREFIX)) {
                this._driver.removeItem(key);
            }
        }
    }

    // === GC ===

    /**
     * Lock-free cross-tab coordination: every tab schedules a timer for the
     * shared `nextGcAt` plus a random 0..randomOffset delay (also applied when
     * the deadline is already missed at startup, so init is never blocked by a
     * sweep). Whoever fires first re-checks the meta, claims the next deadline
     * and sweeps; the rest see the moved deadline and just re-schedule.
     */
    private _scheduleGc() {
        if (this._gcTimer !== null || !this._canSweep()) return;

        const meta = this._readMeta();

        // Meta gone/broken (cleared externally) — GC pauses until next session re-inits.
        if (!meta) return;

        const dueIn = Math.max(0, meta.nextGcAt - Date.now());
        const delay = Math.min(dueIn + Math.random() * GC_OPTIONS.randomOffset, MAX_TIMEOUT);

        this._gcTimer = setTimeout(() => {
            this._gcTimer = null;
            this._runDueGc();
        }, delay);

        unrefSafe(this._gcTimer);
    }

    private _runDueGc() {
        const meta = this._readMeta();

        if (!meta) return;

        // Another tab already claimed and swept (or the timer was clamped) — re-schedule.
        if (Date.now() < meta.nextGcAt) {
            this._scheduleGc();
            return;
        }

        this._writeMeta(Date.now() + GC_OPTIONS.checkInterval + jitter(GC_OPTIONS.randomOffset));
        this._sweep();
        this._scheduleGc();
    }

    private _canSweep() {
        return this._enumerateKeys() !== null;
    }

    /** Chunked sweep: `syncLimit` keys per synchronous slice, then yields. */
    private _sweep() {
        const keys = this._enumerateKeys();

        if (!keys) return;

        const dataKeys = keys.filter((key) => key.startsWith(DATA_KEY_PREFIX));
        let index = 0;

        const step = () => {
            const sliceEnd = Math.min(index + GC_OPTIONS.syncLimit, dataKeys.length);
            const now = Date.now();

            for (; index < sliceEnd; index++) {
                this._sweepKey(dataKeys[index], now);
            }

            if (index < dataKeys.length) {
                unrefSafe(setTimeout(step, 0));
            }
        };

        step();
    }

    private _sweepKey(storageKey: string, now: number) {
        const raw = this._driver.getItem(storageKey);

        if (raw === null) return;

        const envelope = this._parseEnvelope(raw);

        if (!envelope) {
            this._driver.removeItem(storageKey);
            return;
        }

        if (envelope.ttl === null) return;

        const ttl = envelope.ttl ?? LOCAL_STATE_GC_DEFAULTS.maxUnreadTime;

        if (now - envelope.at > ttl) {
            this._driver.removeItem(storageKey);
        }
    }

    // === utils ===

    private _parseEnvelope(raw: string): Envelope | null {
        let json: unknown;

        try {
            json = JSON.parse(raw);
        } catch {
            return null;
        }

        const parsed = envelopeSchema.safeParse(json);
        return parsed.success ? parsed.data : null;
    }

    private _enumerateKeys(): string[] | null {
        const driver = this._driver;

        if (typeof driver.keys === "function") {
            return driver.keys();
        }

        if (typeof driver.key === "function" && typeof driver.length === "number") {
            const result: string[] = [];

            for (let i = 0; i < driver.length; i++) {
                const key = driver.key(i);
                if (key !== null) result.push(key);
            }

            return result;
        }

        return null;
    }
}
