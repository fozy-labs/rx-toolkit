import { createApi, ReactHooksPlugin } from '@fozy-labs/rx-toolkit';
import { Card, CardBody, CardHeader, Divider } from '@heroui/react';
import { fetches } from "../../utils/fetches";

const api = createApi({
    plugins: [new ReactHooksPlugin()],
});

const itemsResource = api.createResource({
    key: 'basic-query-items',
    queryFn: fetches.getItems,
});

export function Base() {
    const state = itemsResource.useResourceAgent();
    const { isRefreshError } = state;

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                📋 Базовый запрос 
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

                {state.isInitialLoading && (
                    <div className="text-center py-8 text-lg">
                        ⏳ Загрузка данных...
                    </div>
                )}

                {state.isSuccess && state.data && (
                    <div className="space-y-2">
                        {state.data.items.map((item: { id: number; name: string; description: string }) => (
                            <div
                                key={item.id}
                                className="p-3 bg-default-100 rounded-lg"
                            >
                                <p className="font-semibold">{item.name}</p>
                                <p className="text-sm text-default-500">{item.description}</p>
                            </div>
                        ))}
                    </div>
                )}

                <Divider />
                <p className="text-xs text-default-400 text-center">
                    createApi → createResource → useResourceAgent — минимальный пример загрузки данных
                </p>
            </CardBody>
        </Card>
    );
}
