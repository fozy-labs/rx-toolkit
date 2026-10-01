import { type StandardSchemaV1, type StandardSchemaV1Result } from "@/common/standard-schema";
import { type SignalOptionsOrKey } from "@/signals/types";

import { Computed } from "./Computed";
import {
    GC_OPTIONS,
    isPlainRecord,
    KEY_PREFIX,
    LOCAL_STATE_GC_DEFAULTS,
    LocalStateStorage,
    slotStorageKey,
    type SlotTtl,
    type StorageLike,
} from "./LocalStateStorage";
import { State } from "./State";

export type LocalStateGcOptions = {
    /** `false` makes the slot GC-exempt (never auto-removed). @default true */
    enabled?: boolean;
    /**
     * Milliseconds a slot may stay unread/unwritten before the GC sweep
     * removes it; must be positive (`Infinity` = exempt), anything else is
     * reported and the default applies.
     * @default LOCAL_STATE_GC_DEFAULTS.maxUnreadTime (60 days)
     */
    maxUnreadTime?: number;
};

export type LocalStateOptions<T> = {
    /**
     * Validates the stored value on load — any Standard Schema implementation
     * (zod, valibot, arktype, ...). The schema output becomes the value;
     * a failure (issues or a throw) drops the slot and falls back to `defaultValue`. Must be
     * synchronous: an async schema is reported and the stored value ignored.
     *
     * Values written by `set()` are stored as the ready value (the schema's
     * output) and trusted on load — validation covers only data not written
     * by this code, so a transforming schema (`transform`, `z.date()`,
     * coercion) does not reject the signal's own writes. Dates survive
     * storage (nested included); other values must be JSON-serializable.
     * When changing the schema incompatibly, change `key`: trusted
     * self-writes are not re-checked against the new schema.
     */
    schema?: StandardSchemaV1<unknown, T>;
    key: string;
    userId?: string;
    checkEffect?: (value: T) => boolean;
    driver?: StorageLike;
    defaultValue: T;
    devtoolsOptions?: SignalOptionsOrKey;
    /** Garbage-collection policy for this slot. @default true */
    gc?: boolean | LocalStateGcOptions;
};

const NONE = Symbol("NONE");

/**
 * The shape of the global GC tuning object (`LocalState.GC_OPTIONS`). Module-local, so a
 * consumer's declaration inlines it: annotating the accessor with `typeof GC_OPTIONS`
 * would point into `LocalStateStorage`, a module the package root does not publish.
 */
type GlobalGcOptions = { syncLimit: number; checkInterval: number; randomOffset: number };

/**
 * `typeof localStorage` guards only against an *undeclared* identifier. In a
 * browser `localStorage` is a defined accessor on `window`, so `typeof` still
 * invokes the getter — which throws `SecurityError` in a sandboxed iframe
 * (no `allow-same-origin`) or when storage is disabled. Wrapping it keeps the
 * static field (and therefore module import) from crashing in those contexts.
 */
function resolveDefaultDriver(): StorageLike | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

/** Duck-typed on purpose: a thenable from another realm fails `instanceof Promise`. */
function isPromiseLike<V>(value: V | PromiseLike<V>): value is PromiseLike<V> {
    return typeof (value as { then?: unknown } | null)?.then === "function";
}

const DATE_TAG = "__LSDate__";

function isDateTag(value: Record<string, unknown>): value is { [DATE_TAG]: string } {
    return typeof value[DATE_TAG] === "string" && Object.keys(value).length === 1;
}

/**
 * Folds `Date` instances (nested included) into tagged plain objects so a
 * schema-written value survives JSON storage; undone by `decodeDates` on the
 * trusted load path. Returns a fresh structure — the stored representation
 * never aliases the in-memory value.
 */
function encodeDates(value: unknown): unknown {
    if (value instanceof Date) return { [DATE_TAG]: value.toJSON() };

    if (Array.isArray(value)) return value.map(encodeDates);

    if (isPlainRecord(value)) {
        const result: Record<string, unknown> = {};

        for (const [key, entry] of Object.entries(value)) {
            result[key] = encodeDates(entry);
        }

        return result;
    }

    return value;
}

/** Undoes `encodeDates`; a malformed tag is left as data, not revived. */
function decodeDates(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(decodeDates);

    if (isPlainRecord(value)) {
        if (isDateTag(value)) {
            const time = Date.parse(value[DATE_TAG]);
            if (!Number.isNaN(time)) return new Date(time);
        }

        const result: Record<string, unknown> = {};

        for (const [key, entry] of Object.entries(value)) {
            result[key] = decodeDates(entry);
        }

        return result;
    }

    return value;
}

/**
 * Collapses the `gc` option into the envelope `ttl` field:
 * `null` = exempt, number = explicit maxUnreadTime, `undefined` = default
 * policy (not persisted, so default changes reach already stored slots).
 * `maxUnreadTime: Infinity` never expires, so it is exempt: JSON stores
 * `Infinity` as `null` anyway, and the policy must equal its stored form.
 * Anything but a positive number (0, negative, NaN) is not a lifetime: it
 * would drive a zero re-touch cadence, so it is reported and the default
 * policy applies.
 */
function resolveSlotTtl(key: string, gc: boolean | LocalStateGcOptions | undefined): SlotTtl {
    if (gc === false) return null;
    if (gc === true || gc === undefined) return undefined;
    if (gc.enabled === false) return null;

    const { maxUnreadTime } = gc;

    if (maxUnreadTime === undefined) return undefined;

    if (!(maxUnreadTime > 0)) {
        console.warn(
            `[LocalSignal]: gc.maxUnreadTime of "${key}" must be a positive number of ms, got ${maxUnreadTime}; the default policy applies`,
        );
        return undefined;
    }

    if (maxUnreadTime === LOCAL_STATE_GC_DEFAULTS.maxUnreadTime) return undefined;
    if (maxUnreadTime === Infinity) return null;
    return maxUnreadTime;
}

export class LocalState<T = string | null | number | undefined> {
    private _state$;
    private _computed;
    private readonly _options;
    private readonly _storage;
    private readonly _storageKey;
    private readonly _slotTtl;
    readonly obs;

    private get _driver() {
        const driver = this._options.driver || LocalState.DEFAULT_DRIVER;

        if (driver === null) {
            throw new Error("[LocalSignal]: localStorage does not exist and no driver was passed.");
        }

        return driver;
    }

    constructor(options: LocalStateOptions<T>) {
        this._options = options;
        this._storage = LocalStateStorage.forDriver(this._driver);
        this._storageKey = slotStorageKey(options.key, options.userId);
        this._slotTtl = resolveSlotTtl(options.key, options.gc);

        // Live registration: this slot is re-touched periodically instead of
        // expiring, so a value held by a running app never hits its maxUnreadTime.
        this._storage.registerSlot(this._storageKey, this._slotTtl);

        let initialValue = this._getStorageValue(options);

        if (initialValue === NONE) {
            initialValue = options.defaultValue;
        }

        this._state$ = new State<T>(initialValue, { isDisabled: true });

        this._computed = new Computed<T>(() => {
            const value = this._state$.get();

            if (options.checkEffect) {
                return options.checkEffect(value) ? value : options.defaultValue;
            }

            return value;
        }, options.devtoolsOptions);

        this.obs = this._computed.obs;
    }

    set(value: T, actionName?: string) {
        // With a schema, storage keeps the ready value (the schema's output
        // domain), marked as such: revalidating it on load as schema INPUT
        // would reject the signal's own writes under a transforming schema.
        if (this._options.schema) {
            this._storage.writeSlot(this._storageKey, encodeDates(value), this._slotTtl, true);
        } else {
            this._storage.writeSlot(this._storageKey, value, this._slotTtl);
        }

        this._state$.set(value, actionName);
    }

    update(updater: (value: T) => T, actionName?: string) {
        this.set(updater(this.peek()), actionName);
    }

    peek() {
        return this._computed.peek();
    }

    get() {
        return this._computed.get();
    }

    clear() {
        this._storage.removeSlot(this._storageKey);
        this._state$.set(this._options.defaultValue);
    }

    private _getStorageValue(options: LocalStateOptions<T>): T | typeof NONE {
        const slot = this._storage.readSlot(this._storageKey, this._slotTtl);

        if (!slot.found) return NONE;

        // Written by set() of this format: already the ready value (the
        // schema's output domain) — serve it without revalidation. Only data
        // NOT written by this code (older versions, foreign writers) goes
        // through the schema below.
        if (slot.out) return decodeDates(slot.data) as T;

        if (!options.schema) return slot.data as T;

        let result: StandardSchemaV1Result<T> | PromiseLike<StandardSchemaV1Result<T>>;

        try {
            result = options.schema["~standard"].validate(slot.data);
        } catch (error) {
            // A throw means the schema could not handle the stored data: treat it
            // as a failed validation, or the slot would crash every later load.
            console.error(`[LocalSignal]: the schema for key "${options.key}" threw on the stored value`, error);
            this._storage.healSlot(this._storageKey);
            return NONE;
        }

        if (isPromiseLike(result)) {
            // The initial value is needed synchronously, so an async schema is
            // a configuration error. The slot is kept: the data may be valid.
            result.then(undefined, () => {});
            console.error(
                `[LocalSignal]: the schema for key "${options.key}" validates asynchronously; ` +
                    "only synchronous schemas are supported, the stored value is ignored",
            );
            return NONE;
        }

        if (result.issues) {
            console.warn(`[LocalSignal]: invalid value for key "${options.key}" in storage`, result.issues);
            // Self-heal: invalid data never becomes valid on its own — drop it
            // so it does not resurface. Gated on format ownership (healSlot):
            // data that only looks invalid to an older package must survive.
            this._storage.healSlot(this._storageKey);
            return NONE;
        }

        return result.value;
    }

    // === static ===

    static KEY_PREFIX = KEY_PREFIX;
    static DEFAULT_DRIVER = resolveDefaultDriver();

    /** Global GC tuning: `checkInterval` / `randomOffset` in ms, `syncLimit` in keys. */
    static get GC_OPTIONS(): GlobalGcOptions {
        return GC_OPTIONS;
    }

    static set GC_OPTIONS(value: GlobalGcOptions) {
        // The GC engine reads the module-level object; replacing the reference
        // would silently disconnect it, so assignment mutates it in place.
        Object.assign(GC_OPTIONS, value);
    }
}
