import React from 'react';
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider } from '@heroui/react';

/**
 * Lifecycle Hooks — демонстрация onQueryStarted и onCacheEntryAdded.
 *
 * onQueryStarted  — вызывается КАЖДЫЙ раз при старте запроса (fetch / refetch / invalidate).
 *                   Получает $queryFulfilled (Promise) и getCacheEntry().
 *
 * onCacheEntryAdded — вызывается ОДИН раз при создании записи кэша.
 *                     Получает $cacheDataLoaded (первая успешная загрузка) и $cacheEntryRemoved (удаление).
 *
 * Разница: onQueryStarted срабатывает при каждом запросе, а onCacheEntryAdded —
 * только при первом появлении записи в кэше (или после resetAll).
 */

interface LogEntry {
    id: number;
    time: string;
    event: string;
    detail?: string;
    kind: 'query' | 'cache' | 'info';
}

type LogSubscriber = (entries: LogEntry[]) => void;

/** Simple log bus — lifecycle callbacks push entries, React subscribes */
function createLogBus() {
    let entries: LogEntry[] = [];
    let nextId = 0;
    let subscriber: LogSubscriber | null = null;

    function push(event: string, detail: string | undefined, kind: LogEntry['kind']) {
        entries = [{ id: ++nextId, time: new Date().toLocaleTimeString(), event, detail, kind }, ...entries].slice(0, 16);
        subscriber?.(entries);
    }

    return {
        push,
        getEntries: () => entries,
        subscribe: (fn: LogSubscriber) => { subscriber = fn; return () => { subscriber = null; }; },
        clear: () => { entries = []; subscriber?.(entries); },
    };
}

const logBus = createLogBus();

let queryCount = 0;

const api = unstable_queryV2.createApi({
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

const dataResource = api.createResourceV2<void, { message: string; queryNum: number }>({
    key: 'lifecycle-demo',
    queryFn: async () => {
        queryCount++;
        const num = queryCount;
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (num % 3 === 0) {
            throw new Error(`Ошибка в запросе #${num}`);
        }

        return { message: `Данные от запроса #${num}`, queryNum: num };
    },

    /**
     * onQueryStarted — fires on EVERY query (initial, invalidate, refetch).
     * $queryFulfilled resolves to { data } on success, rejects on error.
     */
    onQueryStarted: async (_args, { $queryFulfilled }) => {
        logBus.push('onQueryStarted', 'Запрос начат (каждый запрос)', 'query');
        try {
            const { data } = await $queryFulfilled;
            logBus.push('$queryFulfilled ✅', `queryNum = ${data.queryNum}`, 'query');
        } catch (err) {
            logBus.push('$queryFulfilled ❌', String(err), 'query');
        }
    },

    /**
     * onCacheEntryAdded — fires ONCE when cache entry is created.
     * $cacheDataLoaded resolves to TData when first successful fetch completes.
     * $cacheEntryRemoved resolves when entry is removed (GC / resetAll).
     */
    onCacheEntryAdded: async (_args, { $cacheDataLoaded, $cacheEntryRemoved }) => {
        logBus.push('onCacheEntryAdded', 'Запись кэша создана (один раз!)', 'cache');
        try {
            const data = await $cacheDataLoaded;
            logBus.push('$cacheDataLoaded ✅', `queryNum = ${data.queryNum}`, 'cache');
        } catch {
            logBus.push('$cacheDataLoaded ❌', 'Запись удалена до загрузки', 'cache');
            return;
        }
        await $cacheEntryRemoved;
        logBus.push('$cacheEntryRemoved', 'Запись кэша удалена', 'cache');
    },
});

function useLogEntries() {
    const [entries, setEntries] = React.useState<LogEntry[]>(() => logBus.getEntries());
    React.useEffect(() => logBus.subscribe(setEntries), []);
    return entries;
}

const kindColors: Record<LogEntry['kind'], string> = {
    query: 'text-primary',
    cache: 'text-warning-600',
    info: 'text-default-500',
};

export function Base() {
    const state = dataResource.useResourceV2Agent();
    const logEntries = useLogEntries();

    const handleInvalidate = () => {
        logBus.push('action', 'invalidate() — запускает refetch → onQueryStarted', 'info');
        dataResource.invalidate();
    };

    const handleResetAll = () => {
        logBus.push('action', 'resetAll() — удаляет кэш → onCacheEntryRemoved, затем новый onCacheEntryAdded', 'info');
        api.resetAll();
    };

    return (
        <div className="flex flex-col gap-4">
            <Card>
                <CardHeader className="text-xl font-bold">
                    🔗 Lifecycle Hooks (Query v2)
                </CardHeader>
                <Divider />
                <CardBody className="space-y-4">
                    <div className="p-3 bg-primary-50 border border-primary-200 rounded-lg text-sm space-y-1">
                        <p><span className="font-semibold text-primary">onQueryStarted</span> — каждый запрос (fetch / refetch / invalidate)</p>
                        <p><span className="font-semibold text-warning-600">onCacheEntryAdded</span> — один раз при создании записи кэша</p>
                    </div>

                    <div className="flex gap-2 flex-wrap">
                        <span className="px-2 py-1 rounded text-xs font-mono bg-default-100 text-default-500">
                            status: {state.status}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs font-mono ${state.isError ? 'bg-danger-100 text-danger-700' : 'bg-default-100 text-default-400'}`}>
                            isError: {String(state.isError)}
                        </span>
                    </div>

                    {state.isInitialLoading && (
                        <div className="text-center py-4 text-lg">⏳ Загрузка...</div>
                    )}

                    {state.data && (
                        <div className="p-3 bg-success-50 border border-success-200 rounded-lg">
                            <p className="font-semibold">{state.data.message}</p>
                        </div>
                    )}

                    {state.isError && (
                        <div className="p-3 bg-danger-50 border border-danger-200 rounded-lg">
                            <p className="text-danger">❌ {String(state.error)}</p>
                        </div>
                    )}

                    <div className="flex gap-2">
                        <Button color="primary" variant="flat" size="sm" onPress={handleInvalidate}>
                            🔄 Инвалидировать
                        </Button>
                        <Button color="warning" variant="flat" size="sm" onPress={handleResetAll}>
                            💥 Сбросить всё
                        </Button>
                    </div>

                    <p className="text-xs text-default-400">
                        Каждый 3-й запрос возвращает ошибку. Нажмите «Инвалидировать» несколько раз и сравните
                        количество onQueryStarted (каждый раз) vs onCacheEntryAdded (только один раз).
                    </p>
                </CardBody>
            </Card>

            <Card>
                <CardHeader className="font-bold">📜 Лог lifecycle-событий</CardHeader>
                <Divider />
                <CardBody>
                    <div className="space-y-1 font-mono text-xs">
                        {logEntries.map((entry) => (
                            <p key={entry.id} className={kindColors[entry.kind]}>
                                [{entry.time}] <span className="font-semibold">{entry.event}</span>
                                {entry.detail && ` — ${entry.detail}`}
                            </p>
                        ))}
                        {logEntries.length === 0 && (
                            <p className="text-default-400 italic">Ожидание событий...</p>
                        )}
                    </div>
                </CardBody>
            </Card>
        </div>
    );
}
