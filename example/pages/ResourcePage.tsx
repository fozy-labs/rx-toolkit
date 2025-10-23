import React from 'react';
import { createResource, useResourceAgent, SKIP } from '@fozy-labs/rx-toolkit';
import { CodeBlock } from '../components/CodeBlock';

// Мок API для получения данных пользователя
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

// Мок API для получения статистики пользователя
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

// Создаем ресурсы
export const getUserResource = createResource({
    queryFn: fetchUser,
    cacheLifetime: 30000, // 30 секунд
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
    cacheLifetime: 10000, // 10 секунд
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

// Компонент для демонстрации useResourceAgent
function UserProfileSection() {
    const [selectedUserId, setSelectedUserId] = React.useState<number | null>(1);
    const [period, setPeriod] = React.useState<string>('daily');
    const [enableStats, setEnableStats] = React.useState(true);

    // Демонстрация работы с изменяющимися аргументами
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

    console.log('User Query State:', {
        userId: selectedUserId,
        dataUserId: userQuery.data?.id ?? null,
        args: userQuery.args,
        isInitiated: userQuery.isInitiated,
        isLoading: userQuery.isLoading,
        isReloading: userQuery.isReloading,
        isDone: userQuery.isDone,
    });

    return (
        <div className="demo-section">
            <h3>Выбор пользователя</h3>

            <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '10px' }}>
                    <strong>ID пользователя:</strong>
                </label>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {[1, 2, 3, 4, 5].map(id => (
                        <button
                            key={id}
                            onClick={() => setSelectedUserId(id)}
                            style={{
                                padding: '10px 20px',
                                background: selectedUserId === id ? '#1976d2' : '#e0e0e0',
                                color: selectedUserId === id ? 'white' : 'black',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: selectedUserId === id ? 'bold' : 'normal',
                            }}
                        >
                            {id}
                        </button>
                    ))}
                </div>
            </div>

            {/* Отображение пользователя */}
            <div style={{
                padding: '20px',
                background: '#f5f5f5',
                borderRadius: '8px',
                marginBottom: '20px'
            }}>
                <h4>Информация о пользователе:</h4>

                {selectedUserId === null && (
                    <div style={{ color: '#666', fontStyle: 'italic' }}>
                        ⏸️ Запрос пропущен (SKIP)
                    </div>
                )}

                {userQuery.isLoading && (
                    <div className="loading">⏳ Загрузка пользователя...</div>
                )}

                {userQuery.isError && (
                    <div className="error">
                        ❌ Ошибка: {String(userQuery.error)}
                    </div>
                )}

                {userQuery.isSuccess && userQuery.data && (
                    <div style={{
                        display: 'flex',
                        gap: '15px',
                        alignItems: 'center',
                        padding: '15px',
                        background: 'white',
                        borderRadius: '8px',
                    }}>
                        <div style={{ fontSize: '48px' }}>
                            {userQuery.data.avatar}
                        </div>
                        <div>
                            <div style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '5px' }}>
                                {userQuery.data.name}
                            </div>
                            <div style={{ color: '#666', marginBottom: '3px' }}>
                                📧 {userQuery.data.email}
                            </div>
                            <div style={{ color: '#666' }}>
                                💼 {userQuery.data.role}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Управление статистикой */}
            <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                    <input
                        type="checkbox"
                        checked={enableStats}
                        onChange={(e) => setEnableStats(e.target.checked)}
                        style={{ width: '20px', height: '20px' }}
                    />
                    <strong>Показать статистику</strong>
                </label>

                {enableStats && (
                    <div>
                        <label style={{ display: 'block', marginBottom: '10px' }}>
                            <strong>Период:</strong>
                        </label>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            {[
                                { value: 'daily', label: 'День' },
                                { value: 'weekly', label: 'Неделя' },
                                { value: 'monthly', label: 'Месяц' },
                            ].map(({ value, label }) => (
                                <button
                                    key={value}
                                    onClick={() => setPeriod(value)}
                                    style={{
                                        padding: '10px 20px',
                                        background: period === value ? '#388e3c' : '#e0e0e0',
                                        color: period === value ? 'white' : 'black',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontWeight: period === value ? 'bold' : 'normal',
                                    }}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Отображение статистики */}
            <div style={{
                padding: '20px',
                background: '#f5f5f5',
                borderRadius: '8px'
            }}>
                <h4>Статистика активности:</h4>

                {!enableStats && (
                    <div style={{ color: '#666', fontStyle: 'italic' }}>
                        ⏸️ Статистика отключена (SKIP)
                    </div>
                )}

                {enableStats && selectedUserId === null && (
                    <div style={{ color: '#666', fontStyle: 'italic' }}>
                        ⏸️ Выберите пользователя для просмотра статистики
                    </div>
                )}

                {enableStats && statsQuery.isLoading && (
                    <div className="loading">⏳ Загрузка статистики...</div>
                )}

                {enableStats && statsQuery.isError && (
                    <div className="error">
                        ❌ Ошибка: {String(statsQuery.error)}
                    </div>
                )}

                {enableStats && statsQuery.isSuccess && statsQuery.data && (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '15px',
                        padding: '15px',
                        background: 'white',
                        borderRadius: '8px',
                    }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#1976d2' }}>
                                {statsQuery.data.commits}
                            </div>
                            <div style={{ color: '#666', fontSize: '14px' }}>
                                Коммиты
                            </div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#388e3c' }}>
                                {statsQuery.data.pullRequests}
                            </div>
                            <div style={{ color: '#666', fontSize: '14px' }}>
                                Pull Requests
                            </div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#f57c00' }}>
                                {statsQuery.data.reviews}
                            </div>
                            <div style={{ color: '#666', fontSize: '14px' }}>
                                Ревью
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Информация о состоянии */}
            <div style={{
                marginTop: '20px',
                padding: '15px',
                background: '#e3f2fd',
                borderRadius: '8px',
                fontSize: '12px',
                fontFamily: 'monospace'
            }}>
                <div><strong>Состояние запросов:</strong></div>
                <div>
                    👤 User:
                    isInitiated={String(userQuery.isInitiated)},
                    isLoading={String(userQuery.isLoading)},
                    isReloading={String(userQuery.isReloading)},
                    isSuccess={String(userQuery.isSuccess)}
                </div>
                <div>
                    📊 Stats:
                    isInitiated={String(statsQuery.isInitiated)},
                    isLoading={String(statsQuery.isLoading)},
                    isReloading={String(userQuery.isReloading)},
                    isSuccess={String(statsQuery.isSuccess)}
                </div>
            </div>
        </div>
    );
}

const resourceCode = `
export const getUserResource = createResource({
    queryFn: fetchUser,
    cacheLifetime: 30000,
});

export const getUserStatsResource = createResource({
    queryFn: fetchUserStats,
    cacheLifetime: 10000,
});

function UserProfileSection() {
    const [selectedUserId, setSelectedUserId] = useState<number | null>(1);
    const [period, setPeriod] = useState<string>('daily');
    const [enableStats, setEnableStats] = useState(true);
    
    // При изменении selectedUserId автоматически создается новый запрос
    const userQuery = useResourceAgent(
        getUserResource, 
        selectedUserId !== null ? selectedUserId : SKIP
    );
    
    // При изменении userId или period создается новый запрос
    const statsQuery = useResourceAgent(
        getUserStatsResource,
        enableStats && selectedUserId !== null 
            ? { userId: selectedUserId, period } 
            : SKIP
    );
    
    // Старые запросы автоматически отменяются
    // Новые запросы используют кеш если данные свежие
    
    return (
        // ...
    );
}`;

export function ResourcePage() {
    return (
        <div className="example-page">
            <div className="example-header">
                <h1>🔄 Динамические ресурсы</h1>
                <p>
                    Демонстрация работы useResourceAgent с изменяющимися аргументами.
                    При изменении аргументов хук автоматически создает новый запрос,
                    использует кеш для повторных запросов и поддерживает SKIP для
                    условного пропуска запросов.
                </p>
            </div>

            <div className="example-content">
                <div>
                    <UserProfileSection />
                </div>

                <div className="code-panel">
                    <CodeBlock code={resourceCode} />
                </div>
            </div>
        </div>
    );
}

