import React from 'react';
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider } from '@heroui/react';

interface ItemData {
    items: { id: number; name: string }[];
    fetchedAt: string;
}

let fetchCount = 0;

const api = createApi({
    plugins: [reactHooksPlugin()],
});

const itemsResource = api.createResource({
    key: 'error-swr-items',
    queryFn: async (): Promise<ItemData> => {
        fetchCount++;
        await new Promise(resolve => setTimeout(resolve, 800));

        // Каждый чётный запрос — ошибка (имитация нестабильного сервера)
        if (fetchCount % 2 === 0) {
            throw new Error(`Сервер мониторинга недоступен (запрос #${fetchCount})`);
        }

        return {
            items: [
                { id: 1, name: `API Gateway (запрос #${fetchCount})` },
                { id: 2, name: `Платёжный сервис (запрос #${fetchCount})` },
            ],
            fetchedAt: new Date().toLocaleTimeString(),
        }
    },
});

export function Base() {
    const state = itemsResource.useResource();
    const [log, setLog] = React.useState<string[]>([]);

    const { isRefreshError } = state;

    React.useEffect(() => {
        const entry = `[${new Date().toLocaleTimeString()}] status=${state.status}, isRefreshError=${isRefreshError}, hasData=${!!state.data}`;
        setLog(prev => [entry, ...prev].slice(0, 8));
    }, [state.status, isRefreshError, state.data]);

    const handleInvalidate = () => {
        state.refresh();
    };

    return (
        <div className="flex flex-col gap-4">
            <Card>
                <CardHeader className="text-xl font-bold">
                    📡 Мониторинг сервисов
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
                        <span className={`px-2 py-1 rounded text-xs font-mono ${isRefreshError ? 'bg-danger-100 text-danger-700' : 'bg-default-100 text-default-400'}`}>
                            isRefreshError: {String(isRefreshError)}
                        </span>
                        <span className="px-2 py-1 rounded text-xs font-mono bg-default-100 text-default-500">
                            status: {state.status}
                        </span>
                    </div>

                    {/* SWR: ошибка при рефреше — данные остаются, error доступен */}
                    {isRefreshError && (
                        <div className="p-3 bg-warning-50 border border-warning-200 rounded-lg">
                            <p className="text-warning-700 font-semibold">⚠️ Ошибка при обновлении: {String(state.error)}</p>
                            <p className="text-xs text-warning-500 mt-1">
                                Устаревшие данные остаются доступны (SWR-семантика). isError = true, ошибка в state.error.
                            </p>
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
                            {state.data.items.map((item: { id: number; name: string }) => (
                                <div
                                    key={item.id}
                                    className={`p-3 rounded-lg ${isRefreshError ? 'bg-warning-50 border border-warning-200' : 'bg-default-100'}`}
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
                        🔄 Обновить статус
                    </Button>

                    <p className="text-xs text-default-400 text-center">
                        Каждый чётный запрос имитирует таймаут сервера мониторинга. Нажмите кнопку для повторной попытки.
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
