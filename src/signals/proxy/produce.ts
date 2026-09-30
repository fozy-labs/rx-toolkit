/**
 * Minimal copy-on-write draft (immer-like), scoped to plain objects, arrays,
 * Map and Set. The base is never mutated; untouched subtrees keep reference
 * identity, and a recipe that changes nothing — or reverts its edits — returns
 * the base itself (Object.is-equal).
 *
 * Map values are draftable; Set elements and class instances are atomic leaf
 * values — they are replaced wholesale, never drafted. The result holds no
 * drafts: a draft the recipe put into a new container (a spread, `filter`, an
 * object literal, a Set, a Map key) is replaced by its result, in a copy of
 * that container.
 *
 * A draft reads and writes its own copy, never the base, so a frozen base is
 * fine. `Object.defineProperty`, `Object.setPrototypeOf` and
 * `Object.preventExtensions` (hence `Object.freeze`) on a draft throw, and so
 * do property writes on a Map or Set draft.
 */

const DRAFT_STATE = Symbol("rx-toolkit.draft-state");

interface DraftState {
    base: any;
    /**
     * Shallow copy of base, created on the first write to this node. From then
     * on it holds the node's child drafts in place of their base values.
     */
    copy: any | null;
    /** Child drafts handed out before the first write, keyed by property / Map key. */
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

function readAt(container: any, key: unknown): unknown {
    return container instanceof Map ? container.get(key) : container[key as any];
}

function writeAt(container: any, key: unknown, value: unknown): void {
    if (container instanceof Map) container.set(key, value);
    else container[key as any] = value;
}

function unsupported(operation: string): never {
    throw new TypeError(`produce: ${operation} is not supported on a draft`);
}

/**
 * Traps for what a draft does not support. Every draft proxies a detached
 * target, never the base: an operation without a trap would otherwise land on
 * the target, and one on the base would break Proxy invariants for a frozen
 * base and mutate it.
 */
const unsupportedTraps: ProxyHandler<object> = {
    defineProperty: () => unsupported("Object.defineProperty"),
    setPrototypeOf: () => unsupported("Object.setPrototypeOf"),
    preventExtensions: () => unsupported("Object.preventExtensions"),
};

const collectionTraps: ProxyHandler<object> = {
    ...unsupportedTraps,
    set: () => unsupported("assigning a property of a Map or Set"),
    deleteProperty: () => unsupported("deleting a property of a Map or Set"),
};

function createDraft(base: any, onWrite: (() => void) | null): DraftState {
    const state: DraftState = { base, copy: null, drafts: new Map(), draft: null };

    const touch = () => {
        if (state.copy === null) {
            const copy = shallowCopy(base);
            for (const [key, child] of state.drafts) writeAt(copy, key, child);
            state.drafts.clear();
            state.copy = copy;
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

/** The value at `key` as the draft sees it: a child draft handed out for it, or the raw value. */
function current(state: DraftState, key: unknown): unknown {
    if (state.copy !== null) return readAt(state.copy, key);
    return state.drafts.get(key) ?? readAt(state.base, key);
}

function hasOwnEntry(container: any, key: unknown): boolean {
    return container instanceof Map ? container.has(key) : Object.prototype.hasOwnProperty.call(container, key as any);
}

/** Returns the child at `key`, drafting a value still shared with the base. */
function childValue(state: DraftState, touch: () => void, key: unknown): unknown {
    const value = current(state, key);
    // Objects assigned during the recipe are owned by the draft and mutate
    // directly; an inherited member (`__proto__`) is not an entry of the node.
    if (!isDraftable(value) || !Object.is(value, readAt(state.base, key)) || !hasOwnEntry(state.base, key)) {
        return value;
    }
    const child = createDraft(value, touch).draft;
    if (state.copy === null) state.drafts.set(key, child);
    else writeAt(state.copy, key, child);
    return child;
}

function createObjectDraft(state: DraftState, touch: () => void): any {
    // An array target keeps Array.isArray(draft) true.
    return new Proxy(Array.isArray(state.base) ? [] : {}, {
        ...unsupportedTraps,
        get(_target, prop) {
            if (prop === DRAFT_STATE) return state;
            if (typeof prop === "symbol") return Reflect.get(latest(state), prop);
            return childValue(state, touch, prop);
        },
        set(_target, prop, value) {
            // Compared with the child draft, not the raw value: assigning the
            // base value back drops the edits made through the draft.
            if (prop in latest(state) && Object.is(current(state, prop), value)) return true;
            touch();
            state.copy[prop] = value;
            return true;
        },
        deleteProperty(_target, prop) {
            if (!(prop in latest(state))) return true;
            touch();
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
            if (desc === undefined) return undefined;
            // The draft is writable even over a frozen base. Proxy invariants
            // let only the target's own non-configurable `length` of an array
            // be reported as non-configurable.
            if ("value" in desc) desc.writable = true;
            desc.configurable = Reflect.getOwnPropertyDescriptor(target, prop)?.configurable ?? true;
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
    const methods: Record<string | symbol, unknown> = {
        get: (key: unknown) => childValue(state, touch, key),
        has: (key: unknown) => latest(state).has(key),
        set(key: unknown, value: unknown) {
            if (!(latest(state).has(key) && Object.is(current(state, key), value))) {
                touch();
                state.copy.set(key, value);
            }
            return state.draft;
        },
        delete(key: unknown) {
            if (!latest(state).has(key)) return false;
            touch();
            return state.copy.delete(key);
        },
        clear() {
            if (latest(state).size === 0) return;
            touch();
            state.copy.clear();
        },
        keys: () => latest(state).keys(),
        values: function* () {
            for (const key of latest(state).keys()) {
                yield childValue(state, touch, key);
            }
        },
        entries: function* () {
            for (const key of latest(state).keys()) {
                yield [key, childValue(state, touch, key)];
            }
        },
        forEach(callback: (value: unknown, key: unknown, map: unknown) => void, thisArg?: unknown) {
            for (const key of latest(state).keys()) {
                callback.call(thisArg, childValue(state, touch, key), key, state.draft);
            }
        },
    };
    methods[Symbol.iterator] = methods.entries;

    return new Proxy(Object.create(Map.prototype), {
        ...collectionTraps,
        get(_target, prop) {
            if (prop === DRAFT_STATE) return state;
            if (prop === "size") return latest(state).size;
            if (prop in methods) return methods[prop as keyof typeof methods];
            return Reflect.get(latest(state), prop);
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

    return new Proxy(Object.create(Set.prototype), {
        ...collectionTraps,
        get(_target, prop) {
            if (prop === DRAFT_STATE) return state;
            if (prop === "size") return latest(state).size;
            if (prop in methods) return methods[prop as keyof typeof methods];
            return Reflect.get(latest(state), prop);
        },
        getPrototypeOf() {
            return Set.prototype;
        },
    });
}

type Memo = Map<object, unknown>;

/**
 * The plain value for `value`: a draft resolves to its result, and a container
 * the recipe built gets its drafts replaced the same way, in a copy. Each draft
 * resolves once, so a draft placed at two spots gives one shared result.
 */
function finalize(value: unknown, memo: Memo): unknown {
    if (!isDraftable(value)) return value;
    if (memo.has(value)) return memo.get(value);
    memo.set(value, value); // cycles are not supported: a back edge stays as is
    const state: DraftState | undefined = (value as any)[DRAFT_STATE];
    const result = state === undefined ? finalizeEntries(value, null, false, memo) : finalizeDraft(state, memo);
    memo.set(value, result);
    return result;
}

function finalizeDraft(state: DraftState, memo: Memo): unknown {
    // A write touches every ancestor, so nothing below an untouched node changed.
    if (state.copy === null) return state.base;
    const result = finalizeEntries(state.copy, state.base, true, memo);
    return isShallowEqual(result, state.base) ? state.base : result;
}

/**
 * Finalizes the entries of `container`. An entry equal to the one `base` has
 * at the same key is shared with the base, which holds no drafts, so it is
 * not walked. `owned`: the container is a draft's copy and changes in place.
 */
function finalizeEntries(container: any, base: any, owned: boolean, memo: Memo): any {
    if (container instanceof Map) {
        let changed = false;
        const entries: [unknown, unknown][] = [];
        for (const [key, value] of container) {
            const shared = base !== null && base.has(key);
            const nextKey = shared ? key : finalize(key, memo);
            const nextValue = shared && Object.is(value, base.get(key)) ? value : finalize(value, memo);
            changed ||= nextKey !== key || nextValue !== value;
            entries.push([nextKey, nextValue]);
        }
        return changed ? new Map(entries) : container;
    }
    if (container instanceof Set) {
        let changed = false;
        const values: unknown[] = [];
        for (const value of container) {
            const next = base !== null && base.has(value) ? value : finalize(value, memo);
            changed ||= next !== value;
            values.push(next);
        }
        return changed ? new Set(values) : container;
    }
    let result = container;
    for (const key of Reflect.ownKeys(container)) {
        const value = container[key];
        if (base !== null && Object.is(value, base[key])) continue;
        const next = finalize(value, memo);
        if (next === value) continue;
        if (result === container && !owned) result = shallowCopy(container);
        result[key] = next;
    }
    return result;
}

/** Same entries in the same order, compared with Object.is. */
function isShallowEqual(a: any, b: any): boolean {
    if (a instanceof Map || a instanceof Set) {
        if (a.size !== b.size) return false;
        const other = b.entries();
        for (const [key, value] of a.entries()) {
            const [otherKey, otherValue] = other.next().value;
            if (!Object.is(key, otherKey) || !Object.is(value, otherValue)) return false;
        }
        return true;
    }
    const keys = Reflect.ownKeys(a);
    const otherKeys = Reflect.ownKeys(b);
    return (
        keys.length === otherKeys.length && keys.every((key, i) => key === otherKeys[i] && Object.is(a[key], b[key]))
    );
}

export function produce<T extends object>(base: T, recipe: (draft: T) => void): T {
    if (!isDraftable(base)) {
        throw new TypeError("produce: base state must be a plain object, an array, a Map or a Set");
    }
    const state = createDraft(base, null);
    recipe(state.draft as T);
    return finalize(state.draft, new Map()) as T;
}
