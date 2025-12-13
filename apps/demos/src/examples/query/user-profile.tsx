import { createResource, useResourceAgent, SKIP } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider, Switch } from '@heroui/react';
import React from 'react';
import { fetches } from "../../utils/fetches.ts";

export const getUserResource = createResource({
    queryFn: fetches.getUser,
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
    devtoolsName: 'user-profile/getUser',
});

export const getUserStatsResource = createResource({
    queryFn: fetches.getUserStats,
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
    devtoolsName: 'user-profile/getUserStats',
});

export function Base() {
    const [selectedUserId, setSelectedUserId] = React.useState<number>(1);
    const [period, setPeriod] = React.useState<string>('daily');
    const [enableStats, setEnableStats] = React.useState(true);

    const userQuery = useResourceAgent(
        getUserResource,
        selectedUserId,
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

                    {userQuery.isLoading && (
                        <div className="text-center py-4">⏳ Загрузка пользователя...</div>
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

                    {enableStats && statsQuery.isLoading && (
                        <div className="text-center py-4">⏳ Загрузка статистики...</div>
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
            </CardBody>
        </Card>
    );
}

