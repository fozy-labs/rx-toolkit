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

/** Shared by the drafts of one `produce` call. */
interface DraftScope {
    /**
     * Whether the recipe got a child draft. Only a child draft can end up in
     * data the recipe built (the root draft there would be a cycle).
     */
    childDrafts: boolean;
}

interface DraftState {
    scope: DraftScope;
    base: any;
    /**
     * Shallow copy of base, created on the first write to this node. From then
     * on it holds the node's child drafts in place of their base values.
     */
    copy: any | null;
    /** Child drafts handed out before the first write, keyed by property / Map key. */
    drafts: Map<unknown, any>;
    /**
     * Keys (Set elements) whose entry in the copy may differ from the base:
     * written, deleted or holding a child draft. Every other entry is shared
     * with the base, so finalization reads only these.
     */
    dirty: Set<unknown>;
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
    // An own "__proto__" key (a JSON.parse dictionary key) is a data property
    // of the base; Object.assign would write it through the inherited setter
    // and change the prototype of the copy instead.
    if (Object.prototype.hasOwnProperty.call(base, "__proto__")) {
        return Object.create(Object.getPrototypeOf(base), Object.getOwnPropertyDescriptors(base));
    }
    return Object.assign(Object.create(Object.getPrototypeOf(base)), base);
}

function latest(state: DraftState): any {
    return state.copy ?? state.base;
}

function readAt(container: any, key: unknown): unknown {
    return container instanceof Map ? container.get(key) : container[key as any];
}

function writeAt(container: any, key: unknown, value: unknown): void {
    if (container instanceof Map) {
        container.set(key, value);
    } else if (key === "__proto__") {
        // A [[Set]] would hit the inherited setter and change the prototype;
        // an own "__proto__" is an ordinary data key.
        Object.defineProperty(container, key, { value, writable: true, enumerable: true, configurable: true });
    } else {
        container[key as any] = value;
    }
}

/** Records a write to `key` of the node; the caller then changes the copy. */
function write(state: DraftState, touch: () => void, key: unknown): void {
    touch();
    state.dirty.add(key);
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

function createDraft(base: any, scope: DraftScope, onWrite: (() => void) | null): DraftState {
    const state: DraftState = { scope, base, copy: null, drafts: new Map(), dirty: new Set(), draft: null };

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

/** An own property, a Map key or a Set element. */
function hasEntry(container: any, key: unknown): boolean {
    if (container instanceof Map || container instanceof Set) return container.has(key);
    return Object.prototype.hasOwnProperty.call(container, key as any);
}

/** Returns the child at `key`, drafting a value still shared with the base. */
function childValue(state: DraftState, touch: () => void, key: unknown): unknown {
    const value = current(state, key);
    // Objects assigned during the recipe are owned by the draft and mutate
    // directly; an inherited member (`__proto__`) is not an entry of the node.
    if (!isDraftable(value) || !Object.is(value, readAt(state.base, key)) || !hasEntry(state.base, key)) {
        return value;
    }
    state.scope.childDrafts = true;
    state.dirty.add(key);
    const child = createDraft(value, state.scope, touch).draft;
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
            write(state, touch, prop);
            writeAt(state.copy, prop, value);
            return true;
        },
        deleteProperty(_target, prop) {
            if (!(prop in latest(state))) return true;
            write(state, touch, prop);
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
                write(state, touch, key);
                state.copy.set(key, value);
            }
            return state.draft;
        },
        delete(key: unknown) {
            if (!latest(state).has(key)) return false;
            write(state, touch, key);
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
                write(state, touch, value);
                state.copy.add(value);
            }
            return state.draft;
        },
        delete(value: unknown) {
            if (!latest(state).has(value)) return false;
            write(state, touch, value);
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

interface Frame {
    node: object;
    state: DraftState | undefined;
    /** Entries of the node that may hold a draft. */
    children: object[];
    next: number;
}

type Resolve = (value: unknown) => unknown;

/**
 * The plain value for the root draft: a draft resolves to its result, and a
 * container the recipe built gets its drafts replaced the same way, in a
 * copy. Each value resolves once, so a draft placed at two spots gives one
 * shared result. A draft is read at its dirty keys only; a container the
 * recipe built is walked whole, and only when the recipe got a child draft
 * that could sit in it. The walk is iterative, so a deep structure cannot
 * overflow the stack.
 */
function finalize(root: DraftState): unknown {
    const walkBuilt = root.scope.childDrafts;
    const results = new Map<object, unknown>();
    const resolve: Resolve = (value) =>
        value !== null && typeof value === "object" && results.has(value) ? results.get(value) : value;
    const stack: Frame[] = [];

    const enter = (node: object) => {
        if (results.has(node)) return;
        const state: DraftState | undefined = (node as any)[DRAFT_STATE];
        if (state === undefined && !walkBuilt) return;
        const children: object[] = [];
        const visit = (value: unknown) => {
            if (isDraftable(value)) children.push(value);
        };
        if (state === undefined) forEachEntry(node, visit);
        // A write touches every ancestor, so nothing below an untouched node changed.
        else if (state.copy !== null) forEachDirtyEntry(state, visit);
        // A built container with nothing to resolve is its own result.
        if (state === undefined && children.length === 0) return;
        results.set(node, node); // cycles are not supported: a back edge stays as is
        stack.push({ node, state, children, next: 0 });
    };

    enter(root.draft);
    while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        if (frame.next < frame.children.length) {
            enter(frame.children[frame.next++]);
            continue;
        }
        stack.pop();
        results.set(frame.node, resultOf(frame, resolve));
    }
    return results.get(root.draft);
}

function resultOf({ node, state, children }: Frame, resolve: Resolve): unknown {
    if (state === undefined) {
        return children.every((child) => resolve(child) === child) ? node : resolveEntries(node, resolve);
    }
    if (state.copy === null) return state.base;
    const result = resolveDirtyEntries(state, resolve);
    // Only a dirty entry can differ; the full comparison checks the key order.
    return !differsAtDirtyKeys(state, result) && isShallowEqual(result, state.base) ? state.base : result;
}

/** Calls `visit` with each entry of `container`, Map keys included. */
function forEachEntry(container: any, visit: (value: unknown) => void): void {
    if (container instanceof Map) {
        for (const [key, value] of container) {
            visit(key);
            visit(value);
        }
    } else if (container instanceof Set) {
        for (const value of container) visit(value);
    } else {
        forEachKey(container, (key) => visit(container[key]));
    }
}

/**
 * Calls `callback` with each entry key of an array or object: the indices of
 * an array, the enumerable own keys of an object — what `shallowCopy` copies.
 */
function forEachKey(container: any, callback: (key: PropertyKey) => void): void {
    if (Array.isArray(container)) {
        for (let i = 0; i < container.length; i++) callback(i);
        return;
    }
    for (const key of Object.keys(container)) callback(key);
    for (const key of Object.getOwnPropertySymbols(container)) {
        if (Object.prototype.propertyIsEnumerable.call(container, key)) callback(key);
    }
}

function forEachDirtyEntry(state: DraftState, visit: (value: unknown) => void): void {
    const copy = state.copy;
    for (const key of state.dirty) {
        if (!hasEntry(copy, key)) continue;
        visit(key);
        if (!(copy instanceof Set)) visit(readAt(copy, key));
    }
}

/** `container` with every entry resolved; a changed one is copied. */
function resolveEntries(container: any, resolve: Resolve): any {
    if (container instanceof Map || container instanceof Set) return resolveCollection(container, resolve);
    let result = container;
    forEachKey(container, (key) => {
        const value = container[key];
        const next = resolve(value);
        if (next === value) return;
        if (result === container) result = shallowCopy(container);
        writeAt(result, key, next);
    });
    return result;
}

/** A Map or Set with every entry resolved, rebuilt in order when one changed. */
function resolveCollection(container: Map<unknown, unknown> | Set<unknown>, resolve: Resolve): any {
    let changed = false;
    const entries: [unknown, unknown][] = [];
    for (const [key, value] of container.entries()) {
        const next: [unknown, unknown] = [resolve(key), resolve(value)];
        changed ||= next[0] !== key || next[1] !== value;
        entries.push(next);
    }
    if (!changed) return container;
    return container instanceof Map ? new Map(entries) : new Set(entries.map(([value]) => value));
}

/** The draft's copy with its dirty entries resolved: in place, unless a Map key or Set element changes. */
function resolveDirtyEntries(state: DraftState, resolve: Resolve): any {
    const copy = state.copy;
    for (const key of state.dirty) {
        if (!hasEntry(copy, key)) continue;
        // A resolved Map key or Set element takes a rebuild to keep the order.
        if (resolve(key) !== key && (copy instanceof Map || copy instanceof Set)) {
            return resolveCollection(copy, resolve);
        }
        if (copy instanceof Set) continue;
        const value = readAt(copy, key);
        const next = resolve(value);
        if (next !== value) writeAt(copy, key, next);
    }
    return copy;
}

function differsAtDirtyKeys(state: DraftState, result: any): boolean {
    const base = state.base;
    if ((result instanceof Map || result instanceof Set) && result.size !== base.size) return true;
    for (const key of state.dirty) {
        const present = hasEntry(result, key);
        if (present !== hasEntry(base, key)) return true;
        if (present && !(result instanceof Set) && !Object.is(readAt(result, key), readAt(base, key))) return true;
    }
    return false;
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
    const state = createDraft(base, { childDrafts: false }, null);
    recipe(state.draft as T);
    return finalize(state) as T;
}
