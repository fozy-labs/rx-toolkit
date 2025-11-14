import { createResource, useResourceAgent, SKIP } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider, Switch } from '@heroui/react';
import { useState } from 'react';

const fetchUser = async (userId: number) => {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const users = [
        { id: 1, name: 'Алексей Иванов', email: 'alexey@example.com', role: 'Разработчик', avatar: '👨‍💻' },
        { id: 2, name: 'Мария Петрова', email: 'maria@example.com', role: 'Дизайнер', avatar: '👩‍🎨' },
        { id: 3, name: 'Иван Сидоров', email: 'ivan@example.com', role: 'Менеджер', avatar: '👨‍💼' },
        { id: 4, name: 'Елена Кузнецова', email: 'elena@example.com', role: 'Аналитик', avatar: '👩‍💼' },
        { id: 5, name: 'Дмитрий Смирнов', email: 'dmitry@example.com', role: 'Тестировщик', avatar: '👨‍🔬' },
    ];

    const user = users.find(u => u.id === userId);
    if (!user) {
        throw new Error(`Пользователь с ID ${userId} не найден`);
    }
    return user;
};

const userStats = {
    1: { daily: [12, 3, 5], weekly: [67, 15, 28], monthly: [234, 48, 112] },
    2: { daily: [8, 2, 4], weekly: [45, 10, 20], monthly: [180, 35, 90] },
    3: { daily: [5, 1, 2], weekly: [30, 5, 12], monthly: [120, 20, 50] },
    4: { daily: [10, 4, 6], weekly: [55, 12, 25], monthly: [200, 40, 100] },
    5: { daily: [7, 2, 3], weekly: [40, 8, 15], monthly: [150, 30, 70] },
};

const fetchUserStats = async (args: { userId: number; period: string }) => {
    await new Promise(resolve => setTimeout(resolve, 800));
    // @ts-ignore
    const stats = userStats[args.userId][args.period];
    return {
        commits: stats[0],
        pullRequests: stats[1],
        reviews: stats[2],
    }
};

export const getUserResource = createResource({
    queryFn: fetchUser,
    cacheLifetime: 30000,
    async onQueryStarted(args, { $queryFulfilled }) {
        console.log('👤 Запрос пользователя:', args);
        try {
            const result = await $queryFulfilled;
            console.log('✅ Пользователь загружен:', result);
        } catch (error) {
            console.error('❌ Ошибка загрузки пользователя:', error);
        }
    },
});

export const getUserStatsResource = createResource({
    queryFn: fetchUserStats,
    cacheLifetime: 10000,
    async onQueryStarted(args, { $queryFulfilled }) {
        console.log('📊 Запрос статистики:', args);
        try {
            const result = await $queryFulfilled;
            console.log('✅ Статистика загружена:', result);
        } catch (error) {
            console.error('❌ Ошибка загрузки статистики:', error);
        }
    },
});

export function Base() {
    const [selectedUserId, setSelectedUserId] = useState<number | null>(1);
    const [period, setPeriod] = useState<string>('daily');
    const [enableStats, setEnableStats] = useState(true);

    const userQuery = useResourceAgent(
        getUserResource,
        selectedUserId !== null ? selectedUserId : SKIP
    );

    const statsQuery = useResourceAgent(
        getUserStatsResource,
        enableStats && selectedUserId !== null
            ? { userId: selectedUserId, period }
            : SKIP
    );

    const periods = [
        { value: 'daily', label: 'День' },
        { value: 'weekly', label: 'Неделя' },
        { value: 'monthly', label: 'Месяц' },
    ];

    return (
        <Card className="max-w-4xl">
            <CardHeader>
                <h3 className="text-xl font-bold">👤 Профиль пользователя</h3>
            </CardHeader>
            <Divider />
            <CardBody className="space-y-6">
                {/* Выбор пользователя */}
                <div>
                    <p className="text-sm font-semibold mb-2">Выберите пользователя:</p>
                    <div className="flex gap-2 flex-wrap">
                        {[1, 2, 3, 4, 5].map(id => (
                            <Button
                                key={id}
                                color={selectedUserId === id ? "primary" : "default"}
                                variant={selectedUserId === id ? "solid" : "bordered"}
                                onPress={() => setSelectedUserId(id)}
                            >
                                {id}
                            </Button>
                        ))}
                    </div>
                </div>

                {/* Информация о пользователе */}
                <div className="p-4 bg-default-100 rounded-lg">
                    <p className="text-sm font-semibold mb-2">Информация о пользователе:</p>

                    {selectedUserId === null && (
                        <p className="text-default-500 italic">⏸️ Запрос пропущен (SKIP)</p>
                    )}

                    {userQuery.isLoading && (
                        <div className="text-center py-4">⏳ Загрузка пользователя...</div>
                    )}

                    {userQuery.isError && (
                        <div className="text-danger">❌ Ошибка: {String(userQuery.error)}</div>
                    )}

                    {userQuery.isSuccess && userQuery.data && (
                        <div className="flex gap-4 items-center p-4 bg-content1 rounded-lg">
                            <div className="text-5xl">{userQuery.data.avatar}</div>
                            <div className="flex-1">
                                <p className="text-lg font-bold">{userQuery.data.name}</p>
                                <p className="text-sm text-default-500">📧 {userQuery.data.email}</p>
                                <p className="text-sm text-default-500">💼 {userQuery.data.role}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Управление статистикой */}
                <div>
                    <Switch
                        isSelected={enableStats}
                        onValueChange={setEnableStats}
                    >
                        Показать статистику
                    </Switch>
                </div>

                {enableStats && (
                    <div>
                        <p className="text-sm font-semibold mb-2">Период:</p>
                        <div className="flex gap-2">
                            {periods.map(({ value, label }) => (
                                <Button
                                    key={value}
                                    color={period === value ? "success" : "default"}
                                    variant={period === value ? "solid" : "bordered"}
                                    onPress={() => setPeriod(value)}
                                >
                                    {label}
                                </Button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Статистика */}
                <div className="p-4 bg-default-100 rounded-lg">
                    <p className="text-sm font-semibold mb-2">Статистика активности:</p>

                    {!enableStats && (
                        <p className="text-default-500 italic">⏸️ Статистика отключена (SKIP)</p>
                    )}

                    {enableStats && selectedUserId === null && (
                        <p className="text-default-500 italic">⏸️ Выберите пользователя</p>
                    )}

                    {enableStats && statsQuery.isLoading && (
                        <div className="text-center py-4">⏳ Загрузка статистики...</div>
                    )}

                    {enableStats && statsQuery.isError && (
                        <div className="text-danger">❌ Ошибка: {String(statsQuery.error)}</div>
                    )}

                    {enableStats && statsQuery.isSuccess && statsQuery.data && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-center p-4 bg-content1 rounded-lg">
                                <p className="text-3xl font-bold text-primary">{statsQuery.data.commits}</p>
                                <p className="text-sm text-default-500">Коммиты</p>
                            </div>
                            <div className="text-center p-4 bg-content1 rounded-lg">
                                <p className="text-3xl font-bold text-success">{statsQuery.data.pullRequests}</p>
                                <p className="text-sm text-default-500">Pull Requests</p>
                            </div>
                            <div className="text-center p-4 bg-content1 rounded-lg">
                                <p className="text-3xl font-bold text-warning">{statsQuery.data.reviews}</p>
                                <p className="text-sm text-default-500">Ревью</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Информация о состоянии */}
                <div className="p-3 bg-primary/10 rounded-lg text-xs font-mono">
                    <p className="font-semibold mb-1">Состояние запросов:</p>
                    <p>👤 User: isInitiated={String(userQuery.isInitiated)}, isLoading={String(userQuery.isLoading)}, isSuccess={String(userQuery.isSuccess)}</p>
                    <p>📊 Stats: isInitiated={String(statsQuery.isInitiated)}, isLoading={String(statsQuery.isLoading)}, isSuccess={String(statsQuery.isSuccess)}</p>
                </div>
            </CardBody>
        </Card>
    );
}

