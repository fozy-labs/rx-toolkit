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

/** GC defaults: durations in milliseconds, `syncLimit` in keys. */
export const LOCAL_STATE_GC_DEFAULTS = {
    /** Max keys processed synchronously per sweep slice; the rest yields via setTimeout. */
    syncLimit: 20,
    /** How often a GC sweep is due (ms). */
    checkInterval: WEEK,
    /** Random spread applied to GC scheduling instead of cross-tab locking (ms). */
    randomOffset: HOUR,
    /** A slot unread/unwritten for this long (ms) is removed by the sweep. */
    maxUnreadTime: 60 * DAY,
} as const;

/**
 * Global GC tuning, shared by all drivers: `checkInterval` / `randomOffset`
 * are milliseconds, `syncLimit` is a key count. Exposed publicly as
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
 * storage whose meta is missing or carries an OLDER version is wiped and
 * re-marked (no backward compatibility by design). A NEWER version means
 * another session runs a newer package — its data must not be touched.
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
 * - `at` — last-touched timestamp, the LRU input for the sweep (refreshed by
 *   throttled touch-on-read and by the periodic live-slot re-touch);
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

/**
 * Escapes the key-scheme separators so user-supplied parts cannot collide
 * with the `:user:` marker: without this, key "cart:user:42" and
 * key "cart" + userId "42" would map to the same storage key.
 */
function escapeKeyPart(part: string) {
    return part.replace(/%/g, "%25").replace(/:/g, "%3A");
}

export function slotStorageKey(key: string, userId?: string) {
    const base = `${DATA_KEY_PREFIX}${escapeKeyPart(key)}`;
    return userId ? `${base}:user:${escapeKeyPart(userId)}` : base;
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
    private _liveTouchTimer: ReturnType<typeof setTimeout> | null = null;
    private _liveTouchInterval = Infinity;

    /**
     * Slots alive in this session (a `LocalState` instance was constructed
     * for them): the GC re-touches them instead of expiring, so an actively
     * used value never falls to its `maxUnreadTime` while the app runs.
     */
    private readonly _liveSlots = new Map<string, SlotTtl>();

    /**
     * False when the namespace meta carries a NEWER format version (another
     * tab runs a newer package). In that case this session neither wipes nor
     * garbage-collects nor self-heals nor touches entries — it must not
     * destroy or rewrite data of a format it does not understand. Re-checked
     * against the meta before every destructive/mutating slot operation,
     * because another tab may upgrade the namespace at any moment after init.
     */
    private _ownsFormat = true;

    private constructor(driver: StorageLike) {
        this._driver = driver;
    }

    // === slots ===

    /** Marks a slot as alive in this session (see `_liveSlots`). */
    registerSlot(storageKey: string, ttl: SlotTtl) {
        this._liveSlots.set(storageKey, ttl);

        // A slot with a TTL tighter than the GC cadence cannot rely on the
        // ~checkInterval re-touch: another tab (which does not hold it live)
        // would sweep it between rounds. Re-arm the dedicated loop if this
        // slot needs a shorter cadence than the currently armed one.
        const interval = this._minLiveTouchThreshold();

        if (this._liveTouchTimer !== null && interval < this._liveTouchInterval) {
            clearTimeout(this._liveTouchTimer);
            this._liveTouchTimer = null;

            // Re-arming discards the elapsed wait of the cleared timer. Touch
            // now, or a looser slot's imminent refresh would be postponed by
            // up to the full new interval — past its TTL in the worst case.
            if (this._refreshOwnership()) this._touchLiveSlots();
        }

        this._armLiveTouchTimer(interval);
    }

    readSlot(storageKey: string, ttl: SlotTtl): { found: false } | { found: true; data: unknown } {
        const raw = this._driver.getItem(storageKey);

        if (raw === null) return { found: false };

        const envelope = this._parseEnvelope(raw);

        if (!envelope) {
            console.warn(`[LocalSignal]: corrupted storage entry "${storageKey}" is ignored`);
            // Self-heal: broken entries are useless and would otherwise stay forever.
            this.healSlot(storageKey);
            return { found: false };
        }

        // Touch-on-read (throttled): keeps slots that are read but rarely
        // written from expiring under GC. Best-effort — a read must never
        // fail because the freshness write did (e.g. QuotaExceededError).
        if (Date.now() - envelope.at >= this._touchThreshold(ttl) && this._refreshOwnership()) {
            try {
                this.writeSlot(storageKey, envelope.data, ttl);
            } catch {
                // The value itself was read successfully — serve it.
            }
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

    /** Unconditional removal — for the explicit user action (`clear()`). */
    removeSlot(storageKey: string) {
        this._driver.removeItem(storageKey);
    }

    /**
     * Self-heal removal: unlike `removeSlot` it is gated on format ownership
     * (data that merely looks broken to an older package must not be
     * destroyed) and never throws.
     */
    healSlot(storageKey: string) {
        if (!this._refreshOwnership()) return;

        try {
            this._driver.removeItem(storageKey);
        } catch {
            // Best-effort cleanup only.
        }
    }

    // === meta / format ===

    /**
     * One-time per driver. Missing/invalid/older-version meta means the
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

        try {
            this._wipe();
            this._writeMeta(Date.now() + GC_OPTIONS.checkInterval + jitter(GC_OPTIONS.randomOffset));
            this._scheduleGc();
        } catch {
            // Storage rejects writes (quota / private mode): construction must
            // not throw — keep serving reads and defaults without GC this
            // session; the wipe/meta write retries on a later session.
        }
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

        let dueIn = Math.max(0, meta.nextGcAt - Date.now());

        // A deadline farther away than any this code writes was stamped by a
        // session with a skewed clock — heal it, or GC stalls for years.
        const maxDue = GC_OPTIONS.checkInterval + GC_OPTIONS.randomOffset;

        if (dueIn > maxDue) {
            dueIn = GC_OPTIONS.checkInterval;

            try {
                this._writeMeta(Date.now() + GC_OPTIONS.checkInterval + jitter(GC_OPTIONS.randomOffset));
            } catch {
                // Keep the clamped timer; healing retries on the next round.
            }
        }

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

        // The namespace may have been re-marked with a different format
        // version since init — its GC is no longer ours to run.
        if (meta.v !== STORAGE_VERSION) {
            if (meta.v > STORAGE_VERSION) this._ownsFormat = false;
            return;
        }

        this._touchLiveSlots();

        // Re-evaluate the dedicated loop here as well: GC_OPTIONS.checkInterval
        // may have been raised mid-session, turning slots that used to be
        // covered by the GC cadence into ones that need their own loop.
        this._armLiveTouchTimer(this._minLiveTouchThreshold());

        // Another tab already claimed and swept (or the timer was clamped) — re-schedule.
        if (Date.now() < meta.nextGcAt) {
            this._scheduleGc();
            return;
        }

        // The claim must land BEFORE the sweep: it is the only cross-tab
        // dedup — sweeping unclaimed would run concurrent duplicate sweeps.
        try {
            this._writeMeta(Date.now() + GC_OPTIONS.checkInterval + jitter(GC_OPTIONS.randomOffset));
        } catch {
            this._scheduleGc();
            return;
        }

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
        // Slots alive in this session are re-touched, never expired.
        if (this._liveSlots.has(storageKey)) return;

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

    /**
     * Refreshes `at` of this session's live slots (runs on every GC timer
     * fire and on the dedicated live-touch loop, so no tab — including this
     * one — expires a value the app is actively holding). Ownership was
     * checked by the caller.
     */
    private _touchLiveSlots() {
        const now = Date.now();

        for (const [storageKey, ttl] of this._liveSlots) {
            const raw = this._driver.getItem(storageKey);

            if (raw === null) continue;

            const envelope = this._parseEnvelope(raw);

            if (!envelope || now - envelope.at < this._touchThreshold(ttl)) continue;

            try {
                this.writeSlot(storageKey, envelope.data, ttl);
            } catch {
                // Best-effort per slot: one failed write (size-dependent
                // quota) must not leave the remaining slots un-refreshed.
            }
        }
    }

    /**
     * Dedicated re-touch loop for slots whose TTL is tighter than the GC
     * cadence: the GC timer visits live slots only about once per
     * checkInterval, which is too rare to keep e.g. a 4-day slot alive
     * against sweeps from tabs that do not hold it live.
     */
    private _armLiveTouchTimer(interval: number) {
        if (this._liveTouchTimer !== null || interval >= GC_OPTIONS.checkInterval) return;

        this._liveTouchInterval = interval;

        this._liveTouchTimer = setTimeout(
            () => {
                this._liveTouchTimer = null;

                // A newer format owns the namespace — its data is not ours to rewrite.
                if (!this._refreshOwnership()) return;

                this._touchLiveSlots();
                this._armLiveTouchTimer(this._minLiveTouchThreshold());
            },
            Math.min(interval, MAX_TIMEOUT),
        );

        unrefSafe(this._liveTouchTimer);
    }

    private _minLiveTouchThreshold(): number {
        let min = Infinity;

        for (const ttl of this._liveSlots.values()) {
            min = Math.min(min, this._touchThreshold(ttl));
        }

        return min;
    }

    // === utils ===

    /**
     * A slot must be re-touched well before its own TTL expires, not only
     * before the global checkInterval — a slot with `maxUnreadTime` below a
     * week would otherwise expire between touches even while actively read.
     */
    private _touchThreshold(ttl: SlotTtl) {
        const effective = ttl === null ? Infinity : (ttl ?? LOCAL_STATE_GC_DEFAULTS.maxUnreadTime);
        return Math.min(GC_OPTIONS.checkInterval, effective / 2);
    }

    /**
     * Re-reads the namespace version before destructive/mutating slot
     * operations: another tab may have upgraded the format after our init.
     * Missing/broken meta keeps the cached verdict (no evidence of a newer owner).
     */
    private _refreshOwnership(): boolean {
        const meta = this._readMeta();

        if (meta !== null) this._ownsFormat = meta.v === STORAGE_VERSION;

        return this._ownsFormat;
    }

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
