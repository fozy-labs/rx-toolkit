import { first, firstValueFrom, Observable, type Subscriber, type Subscription } from "rxjs";

import { SKIP } from "@/query/constants";
import { IDLE_ENTRY_STATE } from "@/query/core/resource/entry-state";
import type {
    IResource,
    IResourceClutch,
    TClutchWhenSettledOptions,
    TKeyed,
    TResourceClutchState,
} from "@/query/types";
import { untracked } from "@/signals/base/untracked";
import { Signal } from "@/signals/signals/Signal";
import type { ReadonlySignal } from "@/signals/types";

import type { Issue, IssuePath } from "../../types";
import type { QueryRecord } from "../definition/records";
import { FormConfigError } from "../FormConfigError";
import { guard, type Outcome } from "../runtime/guard";
import { callbackIssue } from "../validation/issues";

import { derived, memberPath, nodeKey, type NodeCore } from "./NodeCore";

/**
 * The query nodes of one node. The node reads them only through this interface: its public
 * `queries`, the `queries` of its rule context, its `isPending$` and its own issues.
 */
export interface NodeQueries {
    /** `queries` of the public node: `<k>` and the `<k>$` aliases. */
    readonly nodes: object;
    /** `queries` of the callback contexts: `<k>$` and `<k>.isDebouncing$`. */
    readonly views: object;
    /** A query of the node is in flight or debouncing. Reads every query, so it activates them all. */
    isPending(): boolean;
    /** Appends the `callback` issues of failed query keys. */
    collectIssues(path: IssuePath, out: Issue[]): void;
}

const NO_QUERIES: NodeQueries = Object.freeze({
    nodes: Object.freeze({}),
    views: Object.freeze({}),
    isPending: () => false,
    collectIssues: () => {},
});

/** `ctx` is the context of the query keys, see the Contexts table of the design. */
export function createQueries(
    owner: NodeCore,
    records: Readonly<Record<string, QueryRecord>>,
    ctx: object,
): NodeQueries {
    const entries = Object.entries(records);
    if (entries.length === 0) return NO_QUERIES;

    const queries = entries.map(([name, record]) => ({ name, ...createQuery(owner, name, record, ctx) }));
    const nodes: Record<string, unknown> = {};
    const views: Record<string, unknown> = {};
    for (const { name, node, view } of queries) {
        nodes[name] = node;
        nodes[`${name}$`] = node.state$;
        views[name] = view;
        views[`${name}$`] = node.state$;
    }

    return Object.freeze({
        nodes: Object.freeze(nodes),
        views: Object.freeze(views),
        isPending: () => {
            // No short circuit: one read activates every query of the node.
            let isPending = false;
            for (const query of queries) isPending = query.isPending$() || isPending;
            return isPending;
        },
        collectIssues: (path: IssuePath, out: Issue[]) => {
            for (const { name, key$ } of queries) {
                const outcome = key$();
                if (!outcome.ok) out.push(callbackIssue(owner, path, `queries.${name}`, outcome.error));
            }
        },
    });
}

// ==================== Query node ====================

type AnyResource = IResource<unknown, unknown, unknown>;
type AnyClutch = IResourceClutch<unknown, unknown, unknown>;
type AnyState = TResourceClutchState<unknown, unknown, unknown>;

/** What a truthy key binds: the resource and its keyed args. */
interface Target {
    readonly resource: AnyResource;
    readonly keyed: TKeyed<unknown>;
}

interface QueryParts {
    readonly node: {
        readonly state$: ReadonlySignal<AnyState>;
        readonly isDebouncing$: ReadonlySignal<boolean>;
        readonly whenSettled: (options?: TClutchWhenSettledOptions) => Promise<void>;
    };
    readonly view: { readonly isDebouncing$: ReadonlySignal<boolean> };
    /** The key run: its target, or the error it threw (then the query is skipped). */
    readonly key$: ReadonlySignal<Outcome<Target | null>>;
    readonly isPending$: ReadonlySignal<boolean>;
}

const noop = () => {};

/** Row 1 before the first truthy key: there is no clutch yet, so the methods do nothing. */
const IDLE: AnyState = Object.freeze({ ...IDLE_ENTRY_STATE, retry: noop, invalidate: noop, refresh: noop });

const keyOf = (target: Target | null) => (target ? target.keyed.key : null);

const targetEquals = (a: Target | null, b: Target | null) =>
    a === b || (a !== null && b !== null && a.resource === b.resource && a.keyed.key === b.keyed.key);

const keyEquals = (a: Outcome<Target | null>, b: Outcome<Target | null>) =>
    a.ok && b.ok ? targetEquals(a.value, b.value) : !a.ok && !b.ok && Object.is(a.error, b.error);

/** The Suspense rule of `ResourceClutch.whenSettled()`. */
const isRenderable = (state: AnyState) => state.hasData || state.status === "error";

function isBoundResource(value: unknown): value is { resource: AnyResource; args: unknown } {
    if (typeof value !== "object" || value === null) return false;
    const bound = value as { kind?: unknown; resource?: { createClutch?: unknown } };
    return bound.kind === "resource" && typeof bound.resource?.createClutch === "function";
}

/**
 * One query node: a clutch, the args of its key and a `state$` over `Signal.from`. The first
 * consumer of `state$` activates the node: the key is subscribed, its args switch the clutch and
 * the clutch's `state$` is held. The last one deactivates it with `switch(SKIP)`, so a cold node
 * keeps no args and holds no entry. The clutch is created from the first bound resource.
 */
function createQuery(owner: NodeCore, name: string, record: QueryRecord, ctx: object): QueryParts {
    const where = memberPath(owner.segments, `queries.${name}`);
    const label = `${nodeKey(owner.scope, owner.segments)}/queries.${name}`;
    const debounce = record.debounce;

    let resource: AnyResource | null = null;
    let clutch: AnyClutch | null = null;

    const toTarget = (bound: unknown): Target | null => {
        if (!bound || bound === SKIP) return null;
        if (!isBoundResource(bound)) {
            throw new Error("a query key must return `resource.bind(args)`, a falsy value or SKIP");
        }
        if (resource === null) resource = bound.resource;
        else if (bound.resource !== resource) {
            throw new FormConfigError(where, "binds a different resource than before; a query key binds one resource");
        }
        return { resource, keyed: resource.toKeyed(bound.args) };
    };

    // A throw of the key counts as SKIP and becomes a `callback` issue; a configuration error
    // passes through the guard and is rethrown on every read.
    const key$ = derived(`${label}.key`, () => guard(() => toTarget(record.key(ctx)), where), keyEquals);
    const target$ = derived(
        `${label}.target`,
        () => {
            const outcome = key$();
            return outcome.ok ? outcome.value : null;
        },
        targetEquals,
    );

    const activate = (subscriber: Subscriber<AnyState>) => {
        /** The key applied in this hot period; `undefined` before the first one. */
        let applied: string | null | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let clutchSub: Subscription | undefined;

        const cancel = () => {
            if (timer === undefined) return;
            clearTimeout(timer);
            timer = undefined;
        };
        const observe = () => {
            if (clutchSub || !clutch) return;
            // Subscribing in the same tick holds the entry `switch` created.
            clutchSub = clutch.state$.obs.subscribe({
                next: (state) => subscriber.next(state),
                error: (error: unknown) => subscriber.error(error),
            });
        };
        // Untracked: the key may emit inside an effect run, and `switch` reads signals.
        const apply = (target: Target | null) =>
            untracked(() => {
                cancel();
                applied = keyOf(target);
                if (!target) return clutch?.switch(SKIP);
                if (!clutch) {
                    clutch = target.resource.createClutch();
                    clutch.start();
                }
                clutch.switch(target.keyed);
                observe();
            });

        // Debounce: the first key of the hot period, a falsy key and every key without the option
        // apply at once; a key equal to the applied one only cancels the timer; any other change
        // waits `debounce` ms, restarted by each change. Nothing flushes the timer early.
        const keySub = target$.obs.subscribe({
            next: (target) => {
                const key = keyOf(target);
                if (key === applied) return cancel();
                if (applied === undefined || debounce === null || key === null) return apply(target);
                cancel();
                timer = setTimeout(() => apply(target), debounce);
            },
            error: (error: unknown) => subscriber.error(error),
        });

        if (clutch) observe();
        else subscriber.next(IDLE);

        return () =>
            untracked(() => {
                keySub.unsubscribe();
                cancel();
                clutchSub?.unsubscribe();
                clutch?.switch(SKIP);
            });
    };

    // `"microtask"`: a cold read holds the node until the end of the microtask, so reads in one
    // burst (React calls `getSnapshot` twice) share one activation and get the same object.
    const state$ = Signal.from(new Observable<AnyState>((subscriber) => untracked(() => activate(subscriber))), {
        keepAlive: "microtask",
        key: `${label}$`,
    });

    // The mismatch of the key's args and the clutch's args. Without the option the args reach the
    // clutch in the same flush, so the node never debounces.
    const isDebouncing$ =
        debounce === null
            ? derived(`${label}.isDebouncing$`, () => false)
            : derived(`${label}.isDebouncing$`, () => {
                  const key = keyOf(target$());
                  const state = state$();
                  // A non-idle state exists only once the clutch, and so the resource, does.
                  return key !== (state.status === "idle" ? null : resource!.serialize(state.args));
              });

    const isPending$ = derived(`${label}.isPending$`, () => {
        const isPending = state$().isPending;
        return isDebouncing$() || isPending;
    });

    // The node waits through its own signals, so it stays active while the promise waits.
    const whenSettled = (options?: TClutchWhenSettledOptions): Promise<void> =>
        options?.waitForDone
            ? firstValueFrom(isPending$.obs.pipe(first((isPending) => !isPending))).then(noop)
            : firstValueFrom(state$.obs.pipe(first(isRenderable))).then(noop);

    return {
        node: Object.freeze({ state$, isDebouncing$, whenSettled }),
        view: Object.freeze({ isDebouncing$ }),
        key$,
        isPending$,
    };
}
