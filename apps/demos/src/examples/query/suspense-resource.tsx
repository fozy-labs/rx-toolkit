import React from 'react';
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider, Spinner } from '@heroui/react';

interface User {
    id: number;
    name: string;
    role: string;
    emoji: string;
}

const DB: Record<number, User> = {
    1: { id: 1, name: 'Ада Лавлейс', role: 'Первый программист', emoji: '👩‍💻' },
    2: { id: 2, name: 'Алан Тьюринг', role: 'Криптограф', emoji: '🧠' },
    3: { id: 3, name: 'Грейс Хоппер', role: 'Контр-адмирал', emoji: '⚓' },
};

const api = createApi({
    plugins: [reactHooksPlugin()],
});

// Каждый профиль грузится 1 секунду. Профиль #4 отсутствует — запрос падает с ошибкой.
const userResource = api.createResource({
    key: 'suspense-user',
    queryFn: async ({ id }: { id: number }): Promise<User> => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const user = DB[id];
        if (!user) {
            throw new Error(`Профиль #${id} не найден на сервере`);
        }
        return user;
    },
});

// Error Boundary ловит ошибку, которую useSuspenseResource бросает при провале запроса.
interface BoundaryProps {
    onRetry: () => void;
    children?: React.ReactNode;
}

class ProfileErrorBoundary extends React.Component<BoundaryProps, { error: Error | null }> {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    render() {
        if (this.state.error) {
            return (
                <div className="p-4 bg-danger-50 border border-danger-200 rounded-lg text-center space-y-3">
                    <p className="text-danger font-semibold">❌ {this.state.error.message}</p>
                    <Button color="danger" variant="flat" onPress={this.props.onRetry}>
                        Вернуться к рабочему профилю
                    </Button>
                </div>
            );
        }
        return this.props.children;
    }
}

// Этот компонент «приостанавливается»: пока данных нет — useSuspenseResource бросает
// промис, и React показывает ближайший <Suspense fallback>. data всегда не null.
function ProfileCard({ id }: { id: number }) {
    const { data, isRefreshing } = userResource.useSuspenseResource({ id });

    return (
        <div className="p-4 bg-default-100 rounded-lg flex items-center gap-4">
            <span className="text-4xl">{data.emoji}</span>
            <div>
                <p className="text-lg font-bold">
                    {data.name} {isRefreshing && '🔄'}
                </p>
                <p className="text-sm text-default-500">{data.role}</p>
                <p className="text-xs text-default-400 mt-1">user #{data.id}</p>
            </div>
        </div>
    );
}

export function Base() {
    const [id, setId] = React.useState(1);

    return (
        <Card>
            <CardHeader className="text-xl font-bold">🧑‍💻 Профиль через React Suspense</CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                <div className="flex gap-2 flex-wrap">
                    {[1, 2, 3, 4].map(n => (
                        <Button
                            key={n}
                            size="sm"
                            color={n === 4 ? 'danger' : 'primary'}
                            variant={id === n ? 'solid' : 'flat'}
                            onPress={() => setId(n)}
                        >
                            {n === 4 ? '#4 (ошибка)' : `#${n}`}
                        </Button>
                    ))}
                </div>

                {/*
                  key={id} пересоздаёт Error Boundary при смене профиля,
                  чтобы пойманная ошибка не «залипала» при переключении.
                */}
                <ProfileErrorBoundary key={id} onRetry={() => setId(1)}>
                    <React.Suspense
                        fallback={
                            <div className="flex justify-center py-8">
                                <Spinner label="Загрузка профиля..." />
                            </div>
                        }
                    >
                        <ProfileCard id={id} />
                    </React.Suspense>
                </ProfileErrorBoundary>

                <Divider />
                <p className="text-xs text-default-400 text-center">
                    Первый показ профиля «подвешивает» Suspense (Spinner). Уже загруженные профили
                    показываются мгновенно из кэша. Профиль #4 бросает ошибку — её ловит Error Boundary.
                </p>
            </CardBody>
        </Card>
    );
}
