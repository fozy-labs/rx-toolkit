import { ZodType } from "zod/v4";

import { type SignalOptionsOrKey } from "@/signals/types";

import { Computed } from "./Computed";
import {
    GC_OPTIONS,
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
     * removes it. @default LOCAL_STATE_GC_DEFAULTS.maxUnreadTime (60 days)
     */
    maxUnreadTime?: number;
};

export type LocalStateOptions<T> = {
    zodSchema?: ZodType<T>;
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

/**
 * Collapses the `gc` option into the envelope `ttl` field:
 * `null` = exempt, number = explicit maxUnreadTime, `undefined` = default
 * policy (not persisted, so default changes reach already stored slots).
 */
function resolveSlotTtl(gc: boolean | LocalStateGcOptions | undefined): SlotTtl {
    if (gc === false) return null;
    if (gc === true || gc === undefined) return undefined;
    if (gc.enabled === false) return null;
    if (gc.maxUnreadTime === undefined) return undefined;
    if (gc.maxUnreadTime === LOCAL_STATE_GC_DEFAULTS.maxUnreadTime) return undefined;
    return gc.maxUnreadTime;
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
        this._slotTtl = resolveSlotTtl(options.gc);

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
        this._storage.writeSlot(this._storageKey, value, this._slotTtl);
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

        if (!options.zodSchema) return slot.data as T;

        const parsed = options.zodSchema.safeParse(slot.data);

        if (!parsed.success) {
            console.warn(`[LocalSignal]: invalid value for key "${options.key}" in storage`, parsed.error);
            // Invalid data never becomes valid on its own — drop it so it does
            // not resurface (and does not outlive its TTL as noise).
            this._storage.removeSlot(this._storageKey);
            return NONE;
        }

        return parsed.data;
    }

    // === static ===

    static KEY_PREFIX = KEY_PREFIX;
    static DEFAULT_DRIVER = resolveDefaultDriver();

    /** Global GC tuning (`syncLimit` / `checkInterval` / `randomOffset`), in ms. */
    static GC_OPTIONS = GC_OPTIONS;
}
