import { createApi, reactHooksPlugin, CURRENT_SNAPSHOT_VERSION, type TApiSnapshot } from '@fozy-labs/rx-toolkit';
import { Card, CardBody, CardHeader, Divider } from '@heroui/react';


/**
 * Профили сотрудников — демонстрирует гидрацию из серверного кэша.
 * В реальном приложении snapshot создаётся на сервере через api.getSnapshot().
 */

interface User {
    id: string;
    name: string;
    email: string;
}

// Симулируем snapshot, который мог бы прийти с сервера
const simulatedSnapshot: TApiSnapshot = {
    version: CURRENT_SNAPSHOT_VERSION,
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

const api = createApi({
    keyPrefix: 'ssr-demo',
    initialSnapshot: simulatedSnapshot,
    snapshotValidTime: 600_000, // 10 минут
    plugins: [reactHooksPlugin()],
});

const usersResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: async (args: { id: string }, _abortSignal: AbortSignal) => {
        // В реальном приложении — запрос к серверу
        await new Promise(resolve => setTimeout(resolve, 2000));
        return {
            id: args.id,
            name: `Сотрудник ${args.id} (обновлён с сервера)`,
            email: `user${args.id}@example.com`,
        };
    },
});

function UserCard({ userId }: { userId: string }) {
    const state = usersResource.useResource({ id: userId });
    const { isRefreshError } = state;

    return (
        <div className={`p-3 rounded-lg ${isRefreshError ? 'bg-warning-50 border border-warning-200' : 'bg-default-100'}`}>
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
                    {isRefreshError && (
                        <p className="text-xs text-danger mt-1">⚠️ Ошибка при обновлении: {String(state.error)}</p>
                    )}
                </>
            )}
        </div>
    );
}

export function Base() {
    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                🌐 Профили сотрудников
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                <p className="text-sm text-default-500">
                    Каталог сотрудников загружен из серверного кэша мгновенно.
                    В реальном SSR приложении snapshot создаётся через api.getSnapshot()
                    и передаётся в initialSnapshot при гидрации.
                </p>

                <div className="space-y-2">
                    <UserCard userId="1" />
                    <UserCard userId="2" />
                </div>

                <Divider />

                <p className="text-xs text-default-400 text-center">
                    Профили сотрудников отображаются мгновенно из серверного кэша.
                    Профили обновятся автоматически при следующем визите (stale-while-revalidate).
                </p>
            </CardBody>
        </Card>
    );
}
