import { Card, CardBody, CardHeader, Divider } from '@heroui/react';
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

/**
 * Симуляция SSR snapshot — демонстрирует гидрацию без реальной SSR-инфраструктуры.
 * В реальном приложении snapshot создаётся на сервере через api.getSnapshot().
 */

interface User {
    id: string;
    name: string;
    email: string;
}

// Симулируем snapshot, который мог бы прийти с сервера
const simulatedSnapshot: unstable_queryV2.TApiSnapshot = {
    version: unstable_queryV2.CURRENT_SNAPSHOT_VERSION,
    keyPrefix: 'ssr-demo',
    timestamp: Date.now(),
    resources: {
        'users': {
            entries: {
                '{"id":"1"}': {
                    status: 'success',
                    args: { id: '1' },
                    data: {
                        id: '1',
                        name: 'Иван Петров',
                        email: 'ivan@example.com',
                    } satisfies User,
                    updatedAt: Date.now(),
                },
                '{"id":"2"}': {
                    status: 'success',
                    args: { id: '2' },
                    data: {
                        id: '2',
                        name: 'Мария Сидорова',
                        email: 'maria@example.com',
                    } satisfies User,
                    updatedAt: Date.now(),
                },
            },
        },
    },
};

const api = unstable_queryV2.createApi({
    keyPrefix: 'ssr-demo',
    initialSnapshot: simulatedSnapshot,
    maxSnapshotDataAge: 600_000, // 10 минут
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

const usersResource = api.createResourceV2<{ id: string }, User>({
    key: 'users',
    queryFn: async (args: { id: string }, { abortSignal: _abortSignal }: { abortSignal: AbortSignal }) => {
        // В реальном приложении — запрос к серверу
        await new Promise(resolve => setTimeout(resolve, 2000));
        return {
            id: args.id,
            name: `User ${args.id} (загружен с сервера)`,
            email: `user${args.id}@example.com`,
        };
    },
});

function UserCard({ userId }: { userId: string }) {
    const state = usersResource.useResourceV2Agent({ id: userId });

    return (
        <div className="p-3 bg-default-100 rounded-lg">
            {state.isInitialLoading && (
                <p className="text-default-400">⏳ Загрузка...</p>
            )}
            {state.data && (
                <>
                    <p className="font-semibold">{state.data.name}</p>
                    <p className="text-sm text-default-500">{state.data.email}</p>
                    {state.isRefreshing && (
                        <p className="text-xs text-warning mt-1">🔄 Обновление...</p>
                    )}
                </>
            )}
            {state.isError && (
                <p className="text-danger">❌ Ошибка загрузки</p>
            )}
        </div>
    );
}

export function Base() {
    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                🌐 SSR Snapshot (Query v2 — симуляция)
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                <p className="text-sm text-default-500">
                    Данные загружены из snapshot мгновенно, без запроса к серверу.
                    В реальном SSR приложении snapshot создаётся через api.getSnapshot()
                    и передаётся в initialSnapshot при гидрации.
                </p>

                <div className="space-y-2">
                    <UserCard userId="1" />
                    <UserCard userId="2" />
                </div>

                <Divider />

                <p className="text-xs text-default-400 text-center">
                    Пользователи 1 и 2 отображаются мгновенно из snapshot.
                    Данные будут обновлены при следующем запросе (stale-while-revalidate).
                </p>
            </CardBody>
        </Card>
    );
}
