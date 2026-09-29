import { deepEqual } from "@/common/utils/deepEqual";
import { shallowEqual } from "@/common/utils/shallowEqual";
import type { ReadonlySignal, StateSignal } from "@/signals/types";

import type { Issue, IssuePath, ItemRef, ListState, Parsed, ShowErrors } from "../../types";
import type { DefinitionRecord, ListRecord } from "../definition/records";
import { action } from "../runtime/action";
import { ABSENT, composedParsedEquals, DEFAULTS, isProvided, NOT_PARSED } from "../runtime/values";
import { collectRuleIssues, isShown, withSeverity } from "../validation/issues";
import { createRule, type RuleSignal } from "../validation/rules";

import { buildNode } from "./buildNode";
import {
    derived,
    nodeKey,
    registerNode,
    writable,
    type InstanceScope,
    type NodeCore,
    type ParentCore,
    type ReinitOptions,
} from "./NodeCore";

/**
 * The structure of a list: the base order of item keys and, while a structural draft exists,
 * the current one. `"keys" in structure` ⇔ a draft exists, like a field's `"value" in input`.
 */
interface Structure {
    readonly baseKeys: readonly string[];
    readonly keys?: readonly string[];
}

interface ListMeta {
    readonly isTouched: boolean;
    readonly isSubmitted: boolean;
}

const PRISTINE: ListMeta = Object.freeze({ isTouched: false, isSubmitted: false });
const NO_ISSUES: Issue[] = [];
/** No reinit data is deferred. */
const NOTHING = Symbol("nothing");
/** `reset()` applies the deferred reinit data over pristine items. */
const RESET_REINIT: ReinitOptions = Object.freeze({ keepDirtyValues: false, keepDirtyLists: false });

const currentKeys = (structure: Structure) => structure.keys ?? structure.baseKeys;
const isStructureDirty = (structure: Structure) =>
    structure.keys !== undefined && !shallowEqual(structure.keys, structure.baseKeys);

/**
 * A list node: a keyed array of item nodes. Items are field or group cores whose name is their
 * key: the key is their static segment (devtools, sources), their index the issue path segment.
 *
 * The item registry holds the attached items and the detached ones whose key is still in the
 * structure base, so `reset()` can bring back the same node. A row that leaves both is dropped
 * from the registry and nothing of the list holds it any more.
 */
export class ListCore implements ParentCore {
    readonly kind = "list";
    readonly scope: InstanceScope;
    readonly segments: readonly string[];
    readonly path$: ReadonlySignal<IssuePath>;
    readonly showErrors: ShowErrors;
    readonly rules: readonly RuleSignal[];
    readonly node: object;

    readonly value$: ReadonlySignal<unknown>;
    readonly parsed$: ReadonlySignal<Parsed<unknown>>;
    readonly issues$: ReadonlySignal<Issue[]>;
    readonly visibleErrors$: ReadonlySignal<Issue[]>;
    readonly visibleWarnings$: ReadonlySignal<Issue[]>;
    readonly isValid$: ReadonlySignal<boolean>;
    readonly isPending$: ReadonlySignal<boolean>;
    readonly isTouched$: ReadonlySignal<boolean>;
    readonly isModified$: ReadonlySignal<boolean>;
    readonly isDirty$: ReadonlySignal<boolean>;
    readonly isSubmitted$: ReadonlySignal<boolean>;
    readonly isDisabled$: ReadonlySignal<boolean>;

    private readonly _structure$: StateSignal<Structure>;
    private readonly _meta$: StateSignal<ListMeta>;
    private readonly _server$: StateSignal<Issue[]>;
    /** Key → index of the attached items. */
    private readonly _index$: ReadonlySignal<ReadonlyMap<string, number>>;
    /** Attached items and detached ones still in the structure base. */
    private readonly _registry = new Map<string, NodeCore>();
    private _lastKey = 0;
    /** Reinit data deferred by `keepDirtyLists`, applied by `reset()`. */
    private _deferred: unknown = NOTHING;

    constructor(
        private readonly _record: ListRecord,
        readonly parent: ParentCore,
        name: string,
        initial: unknown,
    ) {
        const scope = parent.scope;
        const segments = [...parent.segments, name];
        const key = nodeKey(scope, segments);
        const signal = <T>(member: string, fn: () => T, equals?: (a: T, b: T) => boolean) =>
            derived(`${key}/${member}`, fn, equals);

        this.scope = scope;
        this.segments = segments;
        this.showErrors = _record.showErrors ?? parent.showErrors;
        this.path$ = signal("path$", () => [...parent.path$(), parent.pathSegment(name)], shallowEqual);
        this._meta$ = writable(`${key}/meta$`, PRISTINE);
        this._server$ = writable(`${key}/server$`, NO_ISSUES);

        // Init: the starting items become the structure base, with no draft.
        const values = listValues(initial === ABSENT ? _record.defaultValue : initial);
        this._structure$ = writable<Structure>(`${key}/keys$`, {
            baseKeys: values.map((value) => this._create(value)),
        });

        const structure$ = this._structure$;
        const keys$ = signal("keys", () => currentKeys(structure$()), shallowEqual);
        const cores$ = signal("cores", () => keys$().map((itemKey) => this._registry.get(itemKey)!), shallowEqual);
        this._index$ = signal("index", () => new Map(keys$().map((itemKey, index) => [itemKey, index])));
        const items$ = signal("items$", () => cores$().map((core) => core.node), shallowEqual);
        const get$ = (itemKey: string): object | undefined => {
            const index = this._index$().get(itemKey);
            return index === undefined ? undefined : items$()[index];
        };

        // ==================== Value ====================

        const value$ = signal("value$", () => cores$().map((core) => core.value$()), shallowEqual);
        const parsed$ = signal(
            "parsed$",
            (): Parsed<unknown> => {
                const value: unknown[] = [];
                for (const core of cores$()) {
                    const parsed = core.parsed$();
                    if (!parsed.isParsed) return NOT_PARSED;
                    value.push(parsed.value);
                }
                return { isParsed: true, value };
            },
            composedParsedEquals,
        );

        // ==================== Rules and issues ====================

        const context$ = scope.context$;
        this.rules = _record.rules.map((rule) => createRule(this, rule, { items$, get$, value$, parsed$, context$ }));

        const ownIssues$ = signal(
            "ownIssues$",
            () => {
                const out: Issue[] = [];
                collectRuleIssues(this, this.path$(), out);
                out.push(...this._server$());
                return out;
            },
            deepEqual,
        );
        const issues$ = signal(
            "issues$",
            () => {
                const out = [...ownIssues$()];
                for (const core of cores$()) out.push(...core.issues$());
                return out;
            },
            deepEqual,
        );
        const errors$ = signal("errors$", () => withSeverity(issues$(), "error"), shallowEqual);
        const warnings$ = signal("warnings$", () => withSeverity(issues$(), "warning"), shallowEqual);
        const ownErrors$ = signal("ownErrors", () => withSeverity(ownIssues$(), "error"), shallowEqual);
        const ownWarnings$ = signal("ownWarnings", () => withSeverity(ownIssues$(), "warning"), shallowEqual);

        // ==================== Flags ====================

        const anyItem = (read: (core: NodeCore) => boolean) => cores$().some(read);
        this.isTouched$ = signal("isTouched$", () => this._meta$().isTouched || anyItem((c) => c.isTouched$()));
        this.isSubmitted$ = signal("isSubmitted$", () => this._meta$().isSubmitted || anyItem((c) => c.isSubmitted$()));
        // The structural draft sticks like a field's: `isModified` stays after the order returns.
        this.isModified$ = signal(
            "isModified$",
            () => structure$().keys !== undefined || anyItem((c) => c.isModified$()),
        );
        this.isDirty$ = signal("isDirty$", () => isStructureDirty(structure$()) || anyItem((c) => c.isDirty$()));
        this.isPending$ = signal("isPending$", () => anyItem((c) => c.isPending$()));
        this.isValid$ = signal("isValid$", () => ownErrors$().length === 0 && cores$().every((c) => c.isValid$()));
        this.isDisabled$ = signal("isDisabled$", () => parent.isDisabled$() || parent.isExcluded(name));

        const visible = (own$: ReadonlySignal<Issue[]>, read: (core: NodeCore) => Issue[]) => () => {
            const out = isShown(this.showErrors, this) ? [...own$()] : [];
            for (const core of cores$()) out.push(...read(core));
            return out;
        };
        this.visibleErrors$ = signal(
            "visibleErrors$",
            visible(ownErrors$, (c) => c.visibleErrors$()),
            shallowEqual,
        );
        this.visibleWarnings$ = signal(
            "visibleWarnings$",
            visible(ownWarnings$, (c) => c.visibleWarnings$()),
            shallowEqual,
        );
        this.value$ = value$;
        this.parsed$ = parsed$;
        this.issues$ = issues$;

        // ==================== Public node ====================

        const state$ = signal(
            "state$",
            (): ListState => {
                const visibleErrors = this.visibleErrors$();
                return {
                    isValid: this.isValid$(),
                    isPending: this.isPending$(),
                    isTouched: this.isTouched$(),
                    isModified: this.isModified$(),
                    isDirty: this.isDirty$(),
                    hasVisibleErrors: visibleErrors.length > 0,
                    visibleErrorCount: visibleErrors.length,
                    isDisabled: this.isDisabled$(),
                    items: items$() as ListState["items"],
                };
            },
            shallowEqual,
        );

        this.node = Object.freeze({
            state$,
            value$,
            parsed$,
            ownIssues$,
            issues$,
            errors$,
            warnings$,
            visibleErrors$: this.visibleErrors$,
            visibleWarnings$: this.visibleWarnings$,
            isValid$: this.isValid$,
            isPending$: this.isPending$,
            isTouched$: this.isTouched$,
            isModified$: this.isModified$,
            isDirty$: this.isDirty$,
            isDisabled$: this.isDisabled$,
            items$,
            get$,
            push: action((initial?: unknown) => this._insert(Infinity, initial)),
            insert: action((index: number, initial?: unknown) => this._insert(index, initial)),
            remove: action((item: ItemRef) => this._remove(item)),
            move: action((item: ItemRef, to: number) => this._move(item, to)),
            swap: action((a: ItemRef, b: ItemRef) => this._swap(a, b)),
            clear: action(() => this._clear()),
            markTouched: action((touched?: boolean) => this.markTouched(touched === undefined ? true : !!touched)),
            reset: action(() => this.reset()),
        });
        registerNode(this);
    }

    /** A list has no `disabled` of its own: its items are excluded only through the inherited flag. */
    isExcluded(): boolean {
        return false;
    }

    /** The index of an attached item; a detached one keeps its key, as it has no position. */
    pathSegment(name: string): string | number {
        return this._index$().get(name) ?? name;
    }

    /**
     * Back to the structure base: added rows are dropped, removed ones come back in the base
     * order, and every row gets a cascading `reset()`. Reinit data deferred by `keepDirtyLists`
     * is applied then.
     */
    reset(): void {
        this._clearOwn();
        const structure = this._structure$.peek();
        if (structure.keys !== undefined) this._structure$.set({ baseKeys: structure.baseKeys });
        this._keepOnly(structure.baseKeys);
        for (const itemKey of structure.baseKeys) this._registry.get(itemKey)!.reset();
        if (this._deferred !== NOTHING) {
            const data = this._deferred;
            this._deferred = NOTHING;
            this._reinit(data, RESET_REINIT);
        }
    }

    markTouched(touched: boolean): void {
        this._patchMeta({ isTouched: touched });
        for (const core of this._attached()) core.markTouched(touched);
    }

    markSubmitted(): void {
        this._patchMeta({ isSubmitted: true });
        for (const core of this._attached()) core.markSubmitted();
    }

    /**
     * Reinit by index over the structure base. With `keepDirtyLists` a dirty structure is kept
     * and the data waits for `reset()`; otherwise the structural draft is dropped.
     */
    reinit(data: unknown, options: ReinitOptions): void {
        if (data === ABSENT) return;
        if (options.keepDirtyLists && isStructureDirty(this._structure$.peek())) {
            this._deferred = data;
            return;
        }
        this._deferred = NOTHING;
        this._reinit(data, options);
    }

    addServerIssues(issues: readonly Issue[]): void {
        if (issues.length) this._server$.set([...this._server$.peek(), ...issues]);
    }

    /** Detached rows too: a row that comes back must not bring back server issues. */
    clearServerIssues(): void {
        this._server$.set(NO_ISSUES);
        for (const core of this._registry.values()) core.clearServerIssues();
    }

    // ==================== Structure ====================

    /** The first N base rows keep their keys and get their own reinit; extra ones go, missing ones are created. */
    private _reinit(data: unknown, options: ReinitOptions): void {
        this._clearOwn();
        const values =
            data === DEFAULTS
                ? listValues(this._record.defaultValue).map((value) => withDefaults(this._record.item, value))
                : listValues(data);
        const structure = this._structure$.peek();
        const baseKeys = values.map((value, index) => {
            const itemKey = structure.baseKeys[index];
            if (itemKey === undefined) return this._create(value);
            this._registry.get(itemKey)!.reinit(value, options);
            return itemKey;
        });
        if (structure.keys !== undefined || !shallowEqual(baseKeys, structure.baseKeys)) {
            this._structure$.set({ baseKeys });
        }
        this._keepOnly(baseKeys);
    }

    private _insert(index: number, initial: unknown): object {
        const keys = this._keys();
        const at = clampIndex(index, keys.length);
        const itemKey = this._create(initial === undefined ? ABSENT : initial);
        this._setKeys([...keys.slice(0, at), itemKey, ...keys.slice(at)]);
        return this._registry.get(itemKey)!.node;
    }

    private _remove(ref: ItemRef): void {
        const itemKey = this._resolve(ref);
        if (itemKey === undefined) return;
        this._setKeys(this._keys().filter((k) => k !== itemKey));
    }

    private _move(ref: ItemRef, to: number): void {
        const itemKey = this._resolve(ref);
        if (itemKey === undefined) return;
        const keys = this._keys().filter((k) => k !== itemKey);
        const at = clampIndex(to, keys.length);
        if (this._keys()[at] === itemKey) return;
        this._setKeys([...keys.slice(0, at), itemKey, ...keys.slice(at)]);
    }

    private _swap(refA: ItemRef, refB: ItemRef): void {
        const a = this._resolve(refA);
        const b = this._resolve(refB);
        if (a === undefined || b === undefined || a === b) return;
        this._setKeys(this._keys().map((k) => (k === a ? b : k === b ? a : k)));
    }

    private _clear(): void {
        if (this._keys().length) this._setKeys([]);
    }

    /**
     * Writes the structural draft. Rows that left it are detached while their key is in the
     * base, and dropped otherwise.
     */
    private _setKeys(keys: readonly string[]): void {
        const { baseKeys } = this._structure$.peek();
        this._structure$.set({ baseKeys, keys });
        this._keepOnly([...baseKeys, ...keys]);
    }

    /** Creates an item core under a new key; `initial` is its starting value or `ABSENT`. */
    private _create(initial: unknown): string {
        const itemKey = `k${++this._lastKey}`;
        this._registry.set(itemKey, buildNode(this._record.item, this, itemKey, initial));
        return itemKey;
    }

    /** Drops the rows whose keys are not in `keys` from the registry. */
    private _keepOnly(keys: readonly string[]): void {
        const kept = new Set(keys);
        // Every key of the structure is registered: equal sizes mean nothing to drop.
        if (this._registry.size === kept.size) return;
        for (const itemKey of this._registry.keys()) {
            if (!kept.has(itemKey)) this._registry.delete(itemKey);
        }
    }

    /** The key of an attached item: by key, by index, or by the item node itself. */
    private _resolve(ref: ItemRef): string | undefined {
        const keys = this._keys();
        if (typeof ref === "number") return Number.isInteger(ref) ? keys[ref] : undefined;
        if (typeof ref === "string") return keys.includes(ref) ? ref : undefined;
        if (typeof ref !== "object" || ref === null) return undefined;
        const itemKey = ref.key;
        return keys.includes(itemKey) && this._registry.get(itemKey)?.node === ref ? itemKey : undefined;
    }

    private _keys(): readonly string[] {
        return currentKeys(this._structure$.peek());
    }

    private _attached(): NodeCore[] {
        return this._keys().map((itemKey) => this._registry.get(itemKey)!);
    }

    private _clearOwn(): void {
        this._patchMeta({ isTouched: false, isSubmitted: false });
        this._server$.set(NO_ISSUES);
    }

    private _patchMeta(patch: Partial<ListMeta>): void {
        const meta = this._meta$.peek();
        const next = { ...meta, ...patch };
        if (!shallowEqual(meta, next)) this._meta$.set(next);
    }
}

/**
 * The items of list data, each as a starting value or `ABSENT` (the presence rule: `undefined`
 * is not a value). Data that is not an array provides no items, as a group ignores data that is
 * not an object.
 */
function listValues(data: unknown): unknown[] {
    return Array.isArray(data) ? data.map((value) => (value === undefined ? ABSENT : value)) : [];
}

/** `index` clamped to `0..max`, as `Array.prototype.splice` does for a position. */
function clampIndex(index: number, max: number): number {
    if (Number.isNaN(index)) return 0;
    return Math.min(Math.max(Math.trunc(index), 0), max);
}

/**
 * An item of the list `defaultValue` for `initialize()` without `state`: every key the item
 * leaves out takes its own `defaultValue`, as it would in a new item.
 */
function withDefaults(record: DefinitionRecord, value: unknown): unknown {
    switch (record.kind) {
        case "field":
            return value === ABSENT ? record.defaultValue : value;
        case "list":
            return listValues(value === ABSENT ? record.defaultValue : value).map((item) =>
                withDefaults(record.item, item),
            );
        case "group": {
            const result: Record<string, unknown> = {};
            for (const [name, child] of Object.entries(record.fields)) {
                const provided = value !== ABSENT && isProvided(value, name);
                result[name] = withDefaults(child, provided ? (value as Record<string, unknown>)[name] : ABSENT);
            }
            return result;
        }
    }
}
