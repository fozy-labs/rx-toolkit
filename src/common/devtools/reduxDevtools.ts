import { Batcher } from "@/signals";

import { DevtoolsLike } from "./types";

interface ReduxDevtoolsExtension {
    connect(options: { name: string }): ReduxDevtoolsConnection;
}

interface ReduxDevtoolsConnection {
    init(state: any): void;
    send(action: any, state: any): void;
}

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
    // Для sync режима используем Batcher.scheduler(Infinity),
    // чтобы обновления devtools происходили в конце батча сигналов
    const batcherScheduler = Batcher.scheduler(Infinity);

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
                // Используем Batcher — выполнится в конце текущего батча сигналов
                // или сразу, если батч не активен
                batcherScheduler.schedule(executePending);
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
    // simply means "no extension", which the check below handles gracefully.
    const globalDriver =
        typeof window !== "undefined"
            ? ((window as any).__REDUX_DEVTOOLS_EXTENSION__ as ReduxDevtoolsExtension | undefined)
            : undefined;
    const devtools = options.driver ?? globalDriver;

    if (!devtools) {
        throw new Error("Redux Devtools extension is not installed");
    }

    const batchStrategy = options.batchStrategy ?? "microtask";
    const taskDelay = options.taskDelay ?? 0;

    let state = {} as Record<string, any>;
    // Ownership bookkeeping. Every state() call is one distinct source instance,
    // so the call itself is the identity — nothing extra is required from the
    // caller. The map holds only strings and numbers (never a reference to the
    // source), and the owner releases its key on disposal, so it stays the size
    // of the live devtools tree instead of growing with every key ever seen.
    const owners = new Map<string, number>();
    let lastInstanceId = 0;
    const connection = devtools.connect({ name: options.name ?? "RxToolkit" });
    connection.init(state);

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

        connection.send({ type }, state);
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

            state = applyState(keys, initState, state);
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
                    state = deleteState(keys, state);
                    markPending(name, "clear", actionName);
                    scheduler.schedule(flushToDevtools);
                    return;
                }

                state = applyState(keys, newState, state);
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

function applyState(keys: string[], newState: any, state: any) {
    const acc = { ...state };
    let current = acc;

    keys.forEach((key, i, arr) => {
        if (i === arr.length - 1) {
            current[key] = newState;
        } else {
            current[key] = { ...(current[key] ?? {}) };
            current = current[key];
        }
    });

    return acc;
}

// Идем по ключам и удалаем последний, если оставется пустой объект, удаляем его рекурсивно
function deleteState(keys: string[], state: any) {
    if (keys.length === 0) return state;

    const acc = { ...state };

    // Рекурсивная функция для удаления с очисткой пустых объектов
    const deleteRecursive = (obj: any, pathKeys: string[], index: number): boolean => {
        const key = pathKeys[index];

        if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) {
            return false;
        }

        if (index === pathKeys.length - 1) {
            delete obj[key];
        } else {
            obj[key] = { ...obj[key] };
            deleteRecursive(obj[key], pathKeys, index + 1);

            // Если объект стал пустым, удаляем его
            if (Object.keys(obj[key]).length === 0) {
                delete obj[key];
            }
        }

        return true;
    };

    deleteRecursive(acc, keys, 0);
    return acc;
}
