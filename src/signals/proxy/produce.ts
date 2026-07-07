/**
 * Minimal copy-on-write draft (immer-like), scoped to plain objects, arrays,
 * Map and Set. The base is never mutated; untouched subtrees keep reference
 * identity, and a recipe that changes nothing returns the base itself
 * (Object.is-equal).
 *
 * Map values are draftable; Set elements and class instances are atomic leaf
 * values — they are replaced wholesale, never drafted.
 */

const DRAFT_STATE = Symbol("rx-toolkit.draft-state");

interface DraftState {
    base: any;
    /** Shallow copy of base, created on first write to this node. */
    copy: any | null;
    modified: boolean;
    /** Child drafts handed out from this node, keyed by property / map key. */
    drafts: Map<unknown, any>;
    draft: any;
}

export function isDraftable(value: unknown): value is object {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value) || value instanceof Map || value instanceof Set) return true;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function shallowCopy(base: any): any {
    if (Array.isArray(base)) return base.slice();
    if (base instanceof Map) return new Map(base);
    if (base instanceof Set) return new Set(base);
    return Object.assign(Object.create(Object.getPrototypeOf(base)), base);
}

function latest(state: DraftState): any {
    return state.copy ?? state.base;
}

function isDraft(value: unknown): boolean {
    return isDraftable(value) && (value as any)[DRAFT_STATE] !== undefined;
}

function createDraft(base: any, onWrite: (() => void) | null): DraftState {
    const state: DraftState = { base, copy: null, modified: false, drafts: new Map(), draft: null };

    const touch = () => {
        if (!state.modified) {
            state.modified = true;
            state.copy = shallowCopy(state.base);
        }
        onWrite?.();
    };

    if (base instanceof Map) {
        state.draft = createMapDraft(state, touch);
    } else if (base instanceof Set) {
        state.draft = createSetDraft(state, touch);
    } else {
        state.draft = createObjectDraft(state, touch);
    }

    return state;
}

/**
 * Returns the (possibly drafted) child at `key`. `read`/`readBase` abstract
 * over property access vs Map.get.
 */
function childValue(
    state: DraftState,
    touch: () => void,
    key: unknown,
    read: (container: any, key: any) => unknown,
): unknown {
    const value = read(latest(state), key);
    const existing = state.drafts.get(key);
    if (existing !== undefined && Object.is(value, existing[DRAFT_STATE].base)) {
        return existing;
    }
    // Draft only values still shared with the base; objects assigned during
    // the recipe are owned by the draft and mutate directly.
    if (isDraftable(value) && !isDraft(value) && Object.is(value, read(state.base, key))) {
        const child = createDraft(value, touch).draft;
        state.drafts.set(key, child);
        return child;
    }
    return value;
}

function createObjectDraft(state: DraftState, touch: () => void): any {
    return new Proxy(state.base, {
        get(target, prop) {
            if (prop === DRAFT_STATE) return state;
            if (typeof prop === "symbol") return Reflect.get(latest(state), prop);
            return childValue(state, touch, prop, (container, key) => container[key]);
        },
        set(_target, prop, value) {
            if (state.drafts.get(prop) === value) return true;
            const source = latest(state);
            if (Object.is(source[prop], value) && prop in source) return true;
            touch();
            state.drafts.delete(prop);
            if (isDraft(value)) {
                state.drafts.set(prop, value);
                state.copy[prop] = (value as any)[DRAFT_STATE].base;
            } else {
                state.copy[prop] = value;
            }
            return true;
        },
        deleteProperty(_target, prop) {
            if (!(prop in latest(state))) return true;
            touch();
            state.drafts.delete(prop);
            delete state.copy[prop];
            return true;
        },
        has(_target, prop) {
            return prop in latest(state);
        },
        ownKeys(_target) {
            return Reflect.ownKeys(latest(state));
        },
        getOwnPropertyDescriptor(target, prop) {
            const desc = Reflect.getOwnPropertyDescriptor(latest(state), prop);
            if (desc && desc.configurable === false && !Reflect.getOwnPropertyDescriptor(target, prop)) {
                desc.configurable = true;
            }
            return desc;
        },
        getPrototypeOf() {
            return Object.getPrototypeOf(state.base);
        },
    });
}

/**
 * Map methods run against `latest(state)`; Map internal slots make a plain
 * Proxy unusable as a receiver, so every method is replaced with a closure.
 */
function createMapDraft(state: DraftState, touch: () => void): any {
    const readEntry = (container: Map<unknown, unknown>, key: unknown) => container.get(key);

    const methods: Record<string | symbol, unknown> = {
        get: (key: unknown) => childValue(state, touch, key, readEntry),
        has: (key: unknown) => latest(state).has(key),
        set(key: unknown, value: unknown) {
            const source: Map<unknown, unknown> = latest(state);
            if (state.drafts.get(key) !== value && !(source.has(key) && Object.is(source.get(key), value))) {
                touch();
                state.drafts.delete(key);
                if (isDraft(value)) {
                    state.drafts.set(key, value);
                    state.copy.set(key, (value as any)[DRAFT_STATE].base);
                } else {
                    state.copy.set(key, value);
                }
            }
            return state.draft;
        },
        delete(key: unknown) {
            if (!latest(state).has(key)) return false;
            touch();
            state.drafts.delete(key);
            return state.copy.delete(key);
        },
        clear() {
            if (latest(state).size === 0) return;
            touch();
            state.drafts.clear();
            state.copy.clear();
        },
        keys: () => latest(state).keys(),
        values: function* () {
            for (const key of latest(state).keys()) {
                yield childValue(state, touch, key, readEntry);
            }
        },
        entries: function* () {
            for (const key of latest(state).keys()) {
                yield [key, childValue(state, touch, key, readEntry)];
            }
        },
        forEach(callback: (value: unknown, key: unknown, map: unknown) => void, thisArg?: unknown) {
            for (const key of latest(state).keys()) {
                callback.call(thisArg, childValue(state, touch, key, readEntry), key, state.draft);
            }
        },
    };
    methods[Symbol.iterator] = methods.entries;

    return new Proxy(state.base, {
        get(target, prop) {
            if (prop === DRAFT_STATE) return state;
            if (prop === "size") return latest(state).size;
            if (prop in methods) return methods[prop as keyof typeof methods];
            return Reflect.get(target, prop);
        },
        getPrototypeOf() {
            return Map.prototype;
        },
    });
}

function createSetDraft(state: DraftState, touch: () => void): any {
    const methods: Record<string | symbol, unknown> = {
        has: (value: unknown) => latest(state).has(value),
        add(value: unknown) {
            if (!latest(state).has(value)) {
                touch();
                state.copy.add(value);
            }
            return state.draft;
        },
        delete(value: unknown) {
            if (!latest(state).has(value)) return false;
            touch();
            return state.copy.delete(value);
        },
        clear() {
            if (latest(state).size === 0) return;
            touch();
            state.copy.clear();
        },
        keys: () => latest(state).keys(),
        values: () => latest(state).values(),
        entries: () => latest(state).entries(),
        forEach(callback: (value: unknown, key: unknown, set: unknown) => void, thisArg?: unknown) {
            for (const value of latest(state).values()) {
                callback.call(thisArg, value, value, state.draft);
            }
        },
    };
    methods[Symbol.iterator] = methods.values;

    return new Proxy(state.base, {
        get(target, prop) {
            if (prop === DRAFT_STATE) return state;
            if (prop === "size") return latest(state).size;
            if (prop in methods) return methods[prop as keyof typeof methods];
            return Reflect.get(target, prop);
        },
        getPrototypeOf() {
            return Set.prototype;
        },
    });
}

function readAt(container: any, key: unknown): unknown {
    return container instanceof Map ? container.get(key) : container[key as any];
}

function finalizeState(state: DraftState): any {
    let result = state.modified ? state.copy : state.base;
    for (const [key, childDraft] of state.drafts) {
        const childState: DraftState = childDraft[DRAFT_STATE];
        // Skip child drafts detached by a later reassignment or delete.
        if (!Object.is(readAt(result, key), childState.base)) continue;
        const finalized = finalizeState(childState);
        if (Object.is(finalized, readAt(result, key))) continue;
        if (result === state.base) result = shallowCopy(state.base);
        if (result instanceof Map) {
            result.set(key, finalized);
        } else {
            result[key as any] = finalized;
        }
    }
    return result;
}

export function produce<T extends object>(base: T, recipe: (draft: T) => void): T {
    if (!isDraftable(base)) {
        throw new TypeError("produce: base state must be a plain object, an array, a Map or a Set");
    }
    const state = createDraft(base, null);
    recipe(state.draft as T);
    return finalizeState(state);
}
