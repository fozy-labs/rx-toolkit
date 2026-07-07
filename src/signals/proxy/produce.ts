/**
 * Minimal copy-on-write producer ("immer-lite") powering {@link unstable_ProxySignal}'s
 * `update(draft => ...)`.
 *
 * The recipe mutates a draft proxy; on return we materialise a new immutable
 * tree that **shares structure** with the base: any subtree the recipe did not
 * touch keeps its original reference. That structural sharing is what lets the
 * reactive tree diff cheaply by identity and fire exactly the affected signals.
 *
 * Scope, deliberately: only arrays and plain objects are drafted. Any other
 * value (class instance, `Map`/`Set`, `Date`, primitive) is an opaque leaf —
 * assigning one replaces a reference wholesale; the producer never clones or
 * reaches inside it.
 *
 * The recipe's return value is ignored on purpose. `draft[key] = value` is an
 * assignment *expression* that evaluates to `value`, so honouring returns would
 * misread the common `update(s => s.k = v)` form as a whole-tree replacement.
 * Use `unstable_ProxySignal.set(next)` for wholesale replacement instead.
 */
import { isPlainContainer, shallowClone } from "./helpers";

/** Internal per-node bookkeeping for a live draft. */
interface DraftState {
    /** Original (frozen-in-spirit) value this draft wraps. */
    base: Record<string | symbol, unknown>;
    /** Lazily-created shallow clone; non-null once this node is modified. */
    copy: Record<string | symbol, unknown> | null;
    /** True once this node or any descendant was written. */
    modified: boolean;
    parent: DraftState | null;
    parentKey: string | null;
    /** The user-facing draft proxy for this node. */
    proxy: unknown;
    /** Cached child drafts, by own key, created lazily on read. */
    children: Map<string, DraftState>;
}

const DRAFT_STATE = Symbol("proxySignal.draftState");

/**
 * The draft bookkeeping behind a value, or `null` if it is not one of this
 * producer's draft proxies. Reading `DRAFT_STATE` is answered before the
 * "draft escaped" guard, so this is safe even after finalization.
 */
function getDraftStateOf(value: unknown): DraftState | null {
    if (value === null || typeof value !== "object") return null;
    return ((value as Record<symbol, unknown>)[DRAFT_STATE] as DraftState | undefined) ?? null;
}

class Producer {
    /** Flipped after the recipe returns; every trap rejects use past this point. */
    private _finalized = false;

    produce<T>(base: T, recipe: (draft: T) => void): T {
        // A non-container root cannot be drafted (nothing to mutate through a
        // proxy). Run the recipe for its side effects and return base untouched;
        // callers replace primitives via `set()`.
        if (!isPlainContainer(base)) {
            recipe(base);
            return base;
        }

        const root = this._createState(base as Record<string, unknown>, null, null);
        recipe(root.proxy as T);
        this._finalized = true;
        return this._finalize(root) as T;
    }

    private _assertLive(): void {
        if (this._finalized) {
            throw new Error(
                "[unstable_ProxySignal] the draft escaped its update() recipe and was used after the update returned. " +
                    "Do not retain or mutate the draft asynchronously.",
            );
        }
    }

    private _createState(
        base: Record<string, unknown>,
        parent: DraftState | null,
        parentKey: string | null,
    ): DraftState {
        const state: DraftState = {
            base: base as Record<string | symbol, unknown>,
            copy: null,
            modified: false,
            parent,
            parentKey,
            proxy: null,
            children: new Map(),
        };

        state.proxy = new Proxy(base, this._createHandler(state));
        return state;
    }

    private _source(state: DraftState): Record<string | symbol, unknown> {
        return state.copy ?? state.base;
    }

    private _ensureCopy(state: DraftState): Record<string | symbol, unknown> {
        if (state.copy === null) {
            state.copy = shallowClone(state.base) as Record<string | symbol, unknown>;
        }
        return state.copy;
    }

    /**
     * Mark this node and every ancestor modified, eagerly cloning ancestors so
     * finalize can splice finalized children back in. This is the copy-on-write
     * path: only nodes on a mutated path get cloned; siblings keep identity.
     */
    private _markModified(state: DraftState): void {
        let node: DraftState | null = state;
        while (node && !node.modified) {
            node.modified = true;
            if (node.parent) this._ensureCopy(node.parent);
            node = node.parent;
        }
    }

    private _createHandler(state: DraftState): ProxyHandler<Record<string, unknown>> {
        // Arrow traps capture `this` (the producer) lexically — no `this` alias.
        return {
            get: (_target, prop, receiver) => {
                if (prop === DRAFT_STATE) return state;
                this._assertLive();

                const source = this._source(state);

                // Symbols (Symbol.iterator on arrays, etc.) and functions
                // (Array.prototype.push, ...) must operate on the live source via
                // the receiver so their internal writes route back through these
                // traps. Never wrap those in a nested draft.
                if (typeof prop === "symbol") {
                    return Reflect.get(source, prop, receiver);
                }

                const value = source[prop];
                if (typeof value === "function") return value;
                // A draft assigned into this key from elsewhere in the recipe
                // (e.g. `d.a = d.b`) is already live — hand it back as-is rather
                // than wrapping a draft around a draft.
                if (getDraftStateOf(value)) return value;
                if (!isPlainContainer(value)) return value;

                // Nested container → lazily draft it. Invalidate a cached child
                // whose underlying value was replaced by a later write.
                let child = state.children.get(prop);
                if (!child || child.base !== value) {
                    child = this._createState(value as Record<string, unknown>, state, prop);
                    state.children.set(prop, child);
                }
                return child.proxy;
            },

            set: (_target, prop, value) => {
                this._assertLive();
                if (typeof prop === "symbol") {
                    this._ensureCopy(state)[prop] = value;
                    this._markModified(state);
                    return true;
                }

                const source = this._source(state);
                const hadKey = prop in source;
                // No-op write on an untouched node: skip so we don't clone (and
                // thus don't spuriously change this node's reference, which would
                // wake value subscribers for a change that didn't happen).
                if (state.copy === null && hadKey && Object.is(source[prop], value)) {
                    return true;
                }

                this._ensureCopy(state)[prop] = value;
                // A fresh value shadows any previously-drafted child at this key.
                state.children.delete(prop);
                this._markModified(state);
                return true;
            },

            deleteProperty: (_target, prop) => {
                this._assertLive();
                const source = this._source(state);
                if (!(prop in source)) return true;

                const copy = this._ensureCopy(state);
                delete copy[prop];
                if (typeof prop === "string") state.children.delete(prop);
                this._markModified(state);
                return true;
            },

            has: (_target, prop) => {
                this._assertLive();
                return prop in this._source(state);
            },

            ownKeys: (_target) => {
                this._assertLive();
                return Reflect.ownKeys(this._source(state));
            },

            getOwnPropertyDescriptor: (_target, prop) => {
                this._assertLive();
                return Reflect.getOwnPropertyDescriptor(this._source(state), prop);
            },

            defineProperty: (_target, prop, descriptor) => {
                this._assertLive();
                Reflect.defineProperty(this._ensureCopy(state), prop, descriptor);
                this._markModified(state);
                return true;
            },

            getPrototypeOf: (_target) => {
                return Reflect.getPrototypeOf(this._source(state));
            },
        };
    }

    /**
     * Turn a draft tree into a plain value. Unmodified nodes return their base
     * (identity preserved → structural sharing); modified nodes return their
     * clone with every embedded draft recursively finalized in place, so the
     * result never leaks a live draft proxy.
     */
    private _finalize(state: DraftState): unknown {
        if (!state.modified) return state.base;

        const copy = state.copy!;

        // 1. Children drafted by *reading* through the draft: `copy[key]` still
        //    holds the base value; the edits live in the child draft.
        for (const [key, child] of state.children) {
            const finalizedChild = this._finalize(child);
            if (!Object.is(copy[key], finalizedChild)) {
                copy[key] = finalizedChild;
            }
        }

        // 2. Values *assigned* into this node may themselves be drafts, or plain
        //    containers holding drafts (`d.a = d.b`, `d.list = d.list.map(...)`).
        //    Untouched base subtrees are draft-free, so only walk what changed.
        const seen = new Set<object>();
        for (const key of Object.keys(copy)) {
            if (state.children.has(key)) continue;
            const value = copy[key];
            if (Object.is(value, (state.base as Record<string, unknown>)[key])) continue;
            const finalized = this._finalizeAssigned(value, seen);
            if (!Object.is(value, finalized)) copy[key] = finalized;
        }

        return copy;
    }

    /**
     * Strip any live draft out of a value assigned during the recipe: finalize a
     * draft to its plain value, and recurse through plain containers (mutating
     * them in place — they are freshly built by the recipe) to unwrap nested
     * drafts. Leaves and cyclic references are returned untouched.
     */
    private _finalizeAssigned(value: unknown, seen: Set<object>): unknown {
        const draft = getDraftStateOf(value);
        if (draft) return this._finalize(draft);

        if (!isPlainContainer(value)) return value;
        if (seen.has(value as object)) return value;
        seen.add(value as object);

        const container = value as Record<string, unknown>;
        for (const key of Object.keys(container)) {
            const finalized = this._finalizeAssigned(container[key], seen);
            if (!Object.is(container[key], finalized)) container[key] = finalized;
        }
        return value;
    }
}

/**
 * Produce the next immutable tree from `base` by running `recipe` against a
 * copy-on-write draft. Returns `base` unchanged (same reference) when the recipe
 * mutates nothing, so callers can short-circuit on `Object.is`.
 */
export function produce<T>(base: T, recipe: (draft: T) => void): T {
    return new Producer().produce(base, recipe);
}
