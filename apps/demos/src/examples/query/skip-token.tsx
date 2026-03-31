import React from 'react';
import { createApi, ReactHooksPlugin, SKIP } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider } from '@heroui/react';
import { fetches } from "../../utils/fetches";

const api = createApi({
    plugins: [new ReactHooksPlugin()],
});

const userResource = api.createResource({
    key: 'skip-token-user',
    queryFn: async (args: { userId: number }) => {
        return fetches.getUser(args.userId);
    },
});

const userIds = [1, 2, 3, 4, 5];

export function Base() {
    const [selectedId, setSelectedId] = React.useState<number | null>(null);

    const state = userResource.useResourceAgent(
        selectedId !== null ? { userId: selectedId } : SKIP,
    );

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                🚫 SKIP Token 
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                {/* Индикаторы состояния */}
                <div className="flex gap-2 flex-wrap">
                    <span className={`px-2 py-1 rounded text-xs font-mono ${selectedId === null ? 'bg-warning-100 text-warning-700' : 'bg-default-100 text-default-400'}`}>
                        args: {selectedId === null ? 'SKIP' : JSON.stringify({ userId: selectedId })}
                    </span>
                    <span className="px-2 py-1 rounded text-xs font-mono bg-default-100 text-default-500">
                        status: {state.status}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-mono ${state.isLoading ? 'bg-warning-100 text-warning-700' : 'bg-default-100 text-default-400'}`}>
                        isLoading: {String(state.isLoading)}
                    </span>
                </div>

                {/* Кнопки выбора пользователя */}
                <div className="flex gap-2 flex-wrap">
                    <Button
                        size="sm"
                        color={selectedId === null ? 'warning' : 'default'}
                        variant={selectedId === null ? 'solid' : 'flat'}
                        onPress={() => setSelectedId(null)}
                    >
                        🚫 SKIP
                    </Button>
                    {userIds.map(id => (
                        <Button
                            key={id}
                            size="sm"
                            color={selectedId === id ? 'primary' : 'default'}
                            variant={selectedId === id ? 'solid' : 'flat'}
                            onPress={() => setSelectedId(id)}
                        >
                            👤 User {id}
                        </Button>
                    ))}
                </div>

                <Divider />

                {/* Результат */}
                {selectedId === null && (
                    <div className="text-center py-8 text-default-400">
                        <p className="text-lg">🚫 Запрос пропущен (SKIP)</p>
                        <p className="text-sm mt-2">Выберите пользователя для загрузки данных</p>
                    </div>
                )}

                {selectedId !== null && state.isInitialLoading && (
                    <div className="text-center py-8 text-lg">
                        ⏳ Загрузка пользователя #{selectedId}...
                    </div>
                )}

                {state.isSuccess && state.data && (
                    <div className="p-4 bg-default-100 rounded-lg">
                        <p className="text-2xl mb-2">{state.data.avatar}</p>
                        <p className="font-semibold text-lg">{state.data.name}</p>
                        <p className="text-sm text-default-500">{state.data.email}</p>
                        <p className="text-sm text-default-400">{state.data.role}</p>
                    </div>
                )}

                <Divider />
                <p className="text-xs text-default-400 text-center">
                    SKIP предотвращает запрос — агент возвращает пустое состояние.
                    При выборе пользователя запрос запускается автоматически.
                </p>
            </CardBody>
        </Card>
    );
}
