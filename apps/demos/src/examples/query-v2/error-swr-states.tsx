import React from 'react';
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider } from '@heroui/react';

interface ItemData {
    items: { id: number; name: string }[];
    fetchedAt: string;
}

let fetchCount = 0;

const api = unstable_queryV2.createApi({
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

const itemsResource = api.createResourceV2<void, ItemData>({
    key: 'error-swr-items',
    queryFn: async () => {
        fetchCount++;
        await new Promise(resolve => setTimeout(resolve, 800));

        // Каждый чётный запрос — ошибка (имитация нестабильного сервера)
        if (fetchCount % 2 === 0) {
            throw new Error(`Сервер недоступен (запрос #${fetchCount})`);
        }

        return {
            items: [
                { id: 1, name: `Элемент A (запрос #${fetchCount})` },
                { id: 2, name: `Элемент B (запрос #${fetchCount})` },
            ],
            fetchedAt: new Date().toLocaleTimeString(),
        };
    },
});

export function Base() {
    const state = itemsResource.useResourceV2Agent();
    const [log, setLog] = React.useState<string[]>([]);

    React.useEffect(() => {
        const entry = `[${new Date().toLocaleTimeString()}] status=${state.status}, isError=${state.isError}, hasData=${!!state.data}`;
        setLog(prev => [entry, ...prev].slice(0, 8));
    }, [state.status, state.isError, state.data]);

    const handleInvalidate = () => {
        itemsResource.invalidate();
    };

    return (
        <div className="flex flex-col gap-4">
            <Card>
                <CardHeader className="text-xl font-bold">
                    ⚠️ Ошибки и SWR-состояния (Query v2)
                </CardHeader>
                <Divider />
                <CardBody className="space-y-4">
                    {/* Индикаторы состояния */}
                    <div className="flex gap-2 flex-wrap">
                        <span className={`px-2 py-1 rounded text-xs font-mono ${state.isLoading ? 'bg-warning-100 text-warning-700' : 'bg-default-100 text-default-400'}`}>
                            isLoading: {String(state.isLoading)}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs font-mono ${state.isSuccess ? 'bg-success-100 text-success-700' : 'bg-default-100 text-default-400'}`}>
                            isSuccess: {String(state.isSuccess)}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs font-mono ${state.isError ? 'bg-danger-100 text-danger-700' : 'bg-default-100 text-default-400'}`}>
                            isError: {String(state.isError)}
                        </span>
                        <span className="px-2 py-1 rounded text-xs font-mono bg-default-100 text-default-500">
                            status: {state.status}
                        </span>
                    </div>

                    {/* Баннер ошибки + устаревшие данные */}
                    {state.isError && (
                        <div className="p-3 bg-danger-50 border border-danger-200 rounded-lg">
                            <p className="text-danger font-semibold">❌ Ошибка: {String(state.error)}</p>
                            {state.data && (
                                <p className="text-xs text-danger-400 mt-1">
                                    Устаревшие данные остаются доступны (SWR-семантика)
                                </p>
                            )}
                        </div>
                    )}

                    {state.isInitialLoading && (
                        <div className="text-center py-8 text-lg">
                            ⏳ Первая загрузка...
                        </div>
                    )}

                    {state.data && (
                        <div className="space-y-2">
                            <p className="text-sm text-default-500">
                                Данные от: {state.data.fetchedAt}
                                {state.isRefreshing && ' 🔄 Обновление...'}
                            </p>
                            {state.data.items.map(item => (
                                <div
                                    key={item.id}
                                    className={`p-3 rounded-lg ${state.isError ? 'bg-warning-50 border border-warning-200' : 'bg-default-100'}`}
                                >
                                    <p className="font-semibold">{item.name}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    <Divider />

                    <Button
                        color="primary"
                        variant="flat"
                        onPress={handleInvalidate}
                        fullWidth
                    >
                        🔄 Инвалидировать (запустить refetch)
                    </Button>

                    <p className="text-xs text-default-400 text-center">
                        Каждый чётный запрос возвращает ошибку. Нажмите кнопку для повторной попытки.
                    </p>
                </CardBody>
            </Card>

            <Card>
                <CardHeader className="font-bold">📜 Лог состояний</CardHeader>
                <Divider />
                <CardBody>
                    <div className="space-y-1 font-mono text-xs">
                        {log.map((entry, i) => (
                            <p key={i} className={i === 0 ? 'text-primary' : 'text-default-400'}>
                                {entry}
                            </p>
                        ))}
                        {log.length === 0 && (
                            <p className="text-default-400 italic">Ожидание событий...</p>
                        )}
                    </div>
                </CardBody>
            </Card>
        </div>
    );
}
