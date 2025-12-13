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
export type BatchStrategy = 'sync' | 'microtask' | 'task';

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
}

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
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pendingFlush: (() => void) | null = null;

    const executePending = () => {
        isPending = false;
        timeoutId = null;
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
            case 'sync':
                // Используем Batcher — выполнится в конце текущего батча сигналов
                // или сразу, если батч не активен
                batcherScheduler.schedule(executePending);
                break;
            case 'microtask':
                queueMicrotask(executePending);
                break;
            case 'task':
                timeoutId = setTimeout(executePending, taskDelay);
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

        /**
         * Отменяет запланированный flush (полезно при cleanup)
         */
        cancel(): void {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            isPending = false;
            pendingFlush = null;
        },

        /**
         * Принудительно выполняет pending flush синхронно
         */
        flush(): void {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (pendingFlush) {
                isPending = false;
                const fn = pendingFlush;
                pendingFlush = null;
                fn();
            }
        }
    };
}

export function reduxDevtools(options: Options = {}): DevtoolsLike {
    const devtools = options.driver ?? (window as any).__REDUX_DEVTOOLS_EXTENSION__ as ReduxDevtoolsExtension | undefined;

    if (!devtools) {
        throw new Error('Redux Devtools extension is not installed');
    }

    const batchStrategy = options.batchStrategy ?? 'microtask';
    const taskDelay = options.taskDelay ?? 0;

    let state = {} as Record<string, any>;
    const connection = devtools.connect({ name: options.name ?? 'RxToolkit' });
    connection.init(state);

    const scheduler = createBatchScheduler(batchStrategy, taskDelay);

    // Отслеживаем тип последнего действия для правильного action type в devtools
    let pendingActionType: 'create' | 'update' | 'clear' = 'update';

    const flushToDevtools = () => {
        connection.send({ type: pendingActionType }, state);
        pendingActionType = 'update'; // Сбрасываем на дефолт после отправки
    };

    return {
        state(name, initState) {
            const keys = name.split('/');

            state = applyState(keys, initState, state);
            pendingActionType = 'create';
            scheduler.schedule(flushToDevtools);

            return (newState) => {
                if (newState === '$COMPLETED' || newState === '$CLEANED') {
                    state = deleteState(keys, state);
                    pendingActionType = 'clear';
                    scheduler.schedule(flushToDevtools);
                    return;
                }

                state = applyState(keys, newState, state);
                // Не перезаписываем 'create' на 'update' если create еще не отправлен
                if (pendingActionType !== 'create') {
                    pendingActionType = 'update';
                }
                scheduler.schedule(flushToDevtools);
            };
        }
    };
}

function applyState(keys: string[], newState: any, state: any) {
    const acc = {...state};
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

    const acc = {...state};

    // Рекурсивная функция для удаления с очисткой пустых объектов
    const deleteRecursive = (obj: any, pathKeys: string[], index: number): boolean => {
        const key = pathKeys[index];

        if (!obj || !obj.hasOwnProperty(key)) {
            return false;
        }

        if (index === pathKeys.length - 1) {
            delete obj[key];
        } else {
            obj[key] = {...obj[key]};
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
