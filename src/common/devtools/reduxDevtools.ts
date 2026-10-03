import { scheduleAfterFlush } from "@/signals/base/core";

import { DevtoolsLike } from "./types";

// Structural types of the browser extension stay module-local type aliases (not
// interfaces): an interface has no name a consumer's declaration could use, and
// declaration emit cannot inline one — a consumer inferring `Options["driver"]`
// would fail with TS4058.
type ReduxDevtoolsExtension = {
    connect(options: { name: string }): ReduxDevtoolsConnection;
};

type ReduxDevtoolsConnection = {
    init(state: any): void;
    send(action: any, state: any): void;
};

/**
 * Стратегия батчинга обновлений:
 * - 'sync' - синхронное выполнение без батчинга (каждое обновление отправляется немедленно)
 * - 'microtask' - пакование в микротаске (queueMicrotask), все обновления в текущем синхронном потоке объединяются
 * - 'task' - пакование в макротаске (setTimeout), с настраиваемой задержкой
 */
export type BatchStrategy = "sync" | "microtask" | "task";

type PendingActionType = "create" | "recreate" | "update" | "clear";

// Fixed rendering order, so the label of a batch does not depend on the order
// in which its keys happened to be touched.
const TYPE_ORDER: PendingActionType[] = ["create", "recreate", "update", "clear"];

// A batch of many named updates would otherwise produce a label too long to
// scan in the devtools timeline.
const MAX_NAMES_IN_ACTION_TYPE = 5;

type Options = {
    name?: string;
    driver?: ReduxDevtoolsExtension;
    /**
     * Стратегия батчинга обновлений
     * @default 'microtask'
     */
    batchStrategy?: BatchStrategy;
    /**
     * Задержка для стратегии 'task' (в миллисекундах)
     * @default 0
     */
    taskDelay?: number;
};

/**
 * Создает планировщик обновлений с указанной стратегией батчинга.
 *
 * Планировщик гарантирует:
 * - Объединение множественных обновлений в один вызов flush
 * - Порядок: сначала все pending обновления, затем flush
 * - Отмену запланированного flush при новых обновлениях (для task стратегии)
 */
function createBatchScheduler(strategy: BatchStrategy, taskDelay: number) {
    let isPending = false;
    let pendingFlush: (() => void) | null = null;

    const executePending = () => {
        isPending = false;
        if (pendingFlush) {
            const fn = pendingFlush;
            pendingFlush = null;
            fn();
        }
    };

    const scheduleExecution = () => {
        if (isPending) return; // Уже запланировано
        isPending = true;

        switch (strategy) {
            case "sync":
                // Очередь «после сброса» ядра сигналов: выполнится в конце текущего батча
                // или сразу, если батч не активен
                scheduleAfterFlush(executePending);
                break;
            case "microtask":
                queueMicrotask(executePending);
                break;
            case "task":
                setTimeout(executePending, taskDelay);
                break;
        }
    };

    return {
        /**
         * Планирует выполнение flush функции.
         * Множественные вызовы schedule до выполнения батча объединяются в один flush.
         */
        schedule(flushFn: () => void): void {
            pendingFlush = flushFn;

            scheduleExecution();
        },
    };
}

export function reduxDevtools(options: Options = {}): DevtoolsLike {
    // `typeof window` guards SSR/Node: a bare `window` reference throws
    // ReferenceError on an undeclared global (optional chaining won't help —
    // the identifier reference throws before any operator applies). No window
    // simply means "no extension", which the check below handles gracefully:
    // a missing extension must not break the app, so it gets a no-op adapter.
    const globalDriver =
        typeof window !== "undefined"
            ? ((window as any).__REDUX_DEVTOOLS_EXTENSION__ as ReduxDevtoolsExtension | undefined)
            : undefined;
    const devtools = options.driver ?? globalDriver;

    if (!devtools) {
        console.error("Redux Devtools extension is not installed");
        return { state: () => () => {} };
    }

    const batchStrategy = options.batchStrategy ?? "microtask";
    const taskDelay = options.taskDelay ?? 0;

    const tree = createTreeNode();
    // Ownership bookkeeping. Every state() call is one distinct source instance,
    // so the call itself is the identity — nothing extra is required from the
    // caller. The map holds only strings and numbers (never a reference to the
    // source), and the owner releases its key on disposal, so it stays the size
    // of the live devtools tree instead of growing with every key ever seen.
    const owners = new Map<string, number>();
    let lastInstanceId = 0;
    const connection = devtools.connect({ name: options.name ?? "RxToolkit" });
    connection.init(tree.view);

    const scheduler = createBatchScheduler(batchStrategy, taskDelay);

    // Per-key bookkeeping of the running batch. One flush carries the whole
    // batch in a single send, so a lone action type/name cannot describe it:
    // the name coming from one key would end up labelling an action that moved
    // other keys too. We record what happened to every key instead and render
    // the batch honestly — the set of types it contains, followed by the names
    // it collected — so a name is never pinned onto a foreign entry.
    const pending = new Map<string, { type: PendingActionType; name: string | null }>();

    const markPending = (key: string, type: PendingActionType, actionName?: string) => {
        const entry = pending.get(key);

        if (!entry) {
            // `||` not `??`: an empty name is no name at all. Anything else
            // would occupy the first-wins slot below with a value that is
            // never rendered, swallowing the next real name of the batch.
            pending.set(key, { type, name: actionName || null });
            return;
        }

        // Structural events (create/recreate/clear) outrank a plain update
        // regardless of order: an update following a create in the same batch
        // is still part of that create, and a key cleared and re-created within
        // one batch ends up as the create it currently is. Between two
        // structural events the later one wins.
        if (type !== "update" || entry.type === "update") {
            entry.type = type;
        }

        // The first name of a key wins — it is the one that opened the
        // transition; the rest are its follow-ups inside the same batch.
        if (entry.name === null && actionName) {
            entry.name = actionName;
        }
    };

    const buildActionType = () => {
        const types = new Set<PendingActionType>();
        // `seen` carries the deduplication and the total count; `names` keeps
        // only what is rendered, so a batch of many distinct names costs no
        // more than the cap.
        const seen = new Set<string>();
        const names: string[] = [];

        pending.forEach((entry) => {
            types.add(entry.type);

            if (!entry.name || seen.has(entry.name)) return;

            seen.add(entry.name);

            if (names.length < MAX_NAMES_IN_ACTION_TYPE) {
                names.push(entry.name);
            }
        });

        const head = TYPE_ORDER.filter((type) => types.has(type))
            .join("+")
            .toUpperCase();

        // An empty batch cannot reach the flush (every schedule() is preceded
        // by a markPending), but the fallback keeps the label well-formed.
        const prefix = head || "UPDATE";

        if (seen.size === 0) return prefix;

        const rest = seen.size - names.length;
        const shown = names.join(", ");

        return rest > 0 ? `${prefix}: ${shown} +${rest} more` : `${prefix}: ${shown}`;
    };

    const flushToDevtools = () => {
        const type = buildActionType();

        // Drained before the send: a throwing extension must not leave the
        // batch behind to mislabel — and inflate — the next one.
        pending.clear();

        connection.send({ type }, tree.view);
    };

    return {
        state(name, initState) {
            const keys = name.split("/");
            const instanceId = ++lastInstanceId;
            // The key is still held by an earlier instance — its source was never
            // disposed (explicitly or by GC). That is not a collision by itself:
            // the usual case is a recreated source whose predecessor is already
            // dead. Take the key over and report it as a recreate; a genuine
            // collision surfaces below, when the superseded instance keeps writing.
            const isRecreate = owners.has(name);

            owners.set(name, instanceId);

            setTreeValue(tree, keys, initState);
            markPending(name, isRecreate ? "recreate" : "create");
            scheduler.schedule(flushToDevtools);

            let hasWarnedOnStaleWrite = false;

            return (newState, actionName?: string) => {
                const ownerId = owners.get(name);

                if (ownerId !== instanceId) {
                    // A late event from a superseded instance. Disposal is routine
                    // here (an explicit dispose() or the GC finalizer of the old
                    // source) and must stay silent — above all it must not delete
                    // the current owner's entry. A write, however, means two live
                    // sources share one key: report it once per instance and drop
                    // the value, so the tree keeps showing the current owner.
                    if (newState !== "$COMPLETED" && newState !== "$CLEANED" && !hasWarnedOnStaleWrite) {
                        hasWarnedOnStaleWrite = true;
                        staleWriteConsoleWarning(name, instanceId, ownerId);
                    }
                    return;
                }

                if (newState === "$COMPLETED" || newState === "$CLEANED") {
                    owners.delete(name);
                    deleteTreeValue(tree, keys);
                    markPending(name, "clear", actionName);
                    scheduler.schedule(flushToDevtools);
                    return;
                }

                setTreeValue(tree, keys, newState);
                markPending(name, "update", actionName);
                scheduler.schedule(flushToDevtools);
            };
        },
    };
}

function staleWriteConsoleWarning(path: string, staleInstanceId: number, ownerId: number | undefined) {
    if (typeof console === "undefined" || typeof console.warn !== "function") {
        return false;
    }

    const owner = ownerId === undefined ? "released (its owner has been disposed)" : `held by instance #${ownerId}`;

    console.warn(`
[RxToolkit Redux Devtools] Warning: key collision on ${path}.
An update arrived from instance #${staleInstanceId}, but the key is ${owner}.
Two live states share the same devtools key, so this update is ignored to keep the tree consistent.
Consider using a unique path for each state or ensure that states are properly disposed when completed.
`);

    return true;
}

// ==================== State tree ====================
//
// Keys are split on "/" into a tree. A key may be a leaf and a parent at once
// ("a/b" next to "a/b/c"), so a node keeps its own value apart from its
// children: the one never overwrites or deletes the other. The rendered view of
// such a node puts its own value under OWN_VALUE_KEY next to the children:
// "." as in a path, where "a/b/." is "a/b" itself.

const OWN_VALUE_KEY = ".";

interface TreeNode {
    hasValue: boolean;
    value: unknown;
    readonly children: Map<string, TreeNode>;
    /** The rendered view, rebuilt along the path of every change (immutable for the extension). */
    view: unknown;
}

function createTreeNode(): TreeNode {
    return { hasValue: false, value: undefined, children: new Map(), view: {} };
}

function renderNode(node: TreeNode): unknown {
    if (node.children.size === 0) return node.value;

    const view: Record<string, unknown> = {};
    if (node.hasValue) view[OWN_VALUE_KEY] = node.value;
    node.children.forEach((child, segment) => {
        view[segment] = child.view;
    });
    return view;
}

/** Re-render the nodes of `path` bottom-up; the root always renders as an object. */
function renderPath(path: TreeNode[]): void {
    for (let i = path.length - 1; i > 0; i--) {
        path[i].view = renderNode(path[i]);
    }
    const root = path[0];
    root.view = root.children.size === 0 ? {} : renderNode(root);
}

function setTreeValue(root: TreeNode, keys: string[], value: unknown): void {
    const path = [root];
    let node = root;

    for (const key of keys) {
        let child = node.children.get(key);
        if (!child) {
            child = createTreeNode();
            node.children.set(key, child);
        }
        node = child;
        path.push(node);
    }

    node.hasValue = true;
    node.value = value;
    renderPath(path);
}

function deleteTreeValue(root: TreeNode, keys: string[]): void {
    const path = [root];
    let node = root;

    for (const key of keys) {
        const child = node.children.get(key);
        if (!child) return;
        node = child;
        path.push(node);
    }

    node.hasValue = false;
    node.value = undefined;

    // Drop the nodes left with neither a value nor children.
    for (let i = path.length - 1; i > 0; i--) {
        const current = path[i];
        if (current.hasValue || current.children.size > 0) break;
        path[i - 1].children.delete(keys[i - 1]);
        path.length = i;
    }

    renderPath(path);
}
