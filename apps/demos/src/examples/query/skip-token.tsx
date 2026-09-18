import React from 'react';
import { createApi, reactHooksPlugin, SKIP } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, cn, Divider } from '@heroui/react';
import { fetches } from "../../utils/fetches";

const api = createApi({
    plugins: [reactHooksPlugin()],
});

const userIds = [1, 2, 3, 4, 5];
const userLabels: Record<number, string> = { 1: 'Алексей И.', 2: 'Мария П.', 3: 'Дмитрий К.', 4: 'Елена С.', 5: 'Сергей В.' };

const userResource = api.createResource({
    key: 'skip-token-user',
    queryFn: fetches.getUser,
    /**
     * Placeholder for arguments that have nothing cached yet: the card is drawn
     * from the name we already know, as `dataSource: "placeholder"`, and is
     * never written to the cache.
     *
     * Returning `null` once `previous` exists gives the screen back to the SWR
     * fallback — the previously selected employee stays visible as
     * `dataSource: "previous"` until the new one arrives.
     */
    placeholderData: (id, previous) => previous
        ? null
        : {
            data: {
                id,
                name: userLabels[id] ?? `Сотрудник #${id}`,
                email: '—',
                role: 'профиль загружается…',
                avatar: '👤',
            },
        },
});

export function Base() {
    const [selectedId, setSelectedId] = React.useState<number | null>(null);

    const state = userResource.useResource(
        selectedId !== null ? selectedId : SKIP,
    );

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                👤 Карточка сотрудника
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
                    <span className={`px-2 py-1 rounded text-xs font-mono ${state.dataSource === 'current' ? 'bg-success-100 text-success-700' : 'bg-default-100 text-default-500'}`}>
                        dataSource: {state.dataSource}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-mono ${state.isPending ? 'bg-warning-100 text-warning-700' : 'bg-default-100 text-default-400'}`}>
                        isPending: {String(state.isPending)}
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
                        Без выбора
                    </Button>
                    {userIds.map(id => (
                        <Button
                            key={id}
                            size="sm"
                            color={selectedId === id ? 'primary' : 'default'}
                            variant={selectedId === id ? 'solid' : 'flat'}
                            onPress={() => setSelectedId(id)}
                        >
                            👤 {userLabels[id]}
                        </Button>
                    ))}
                </div>

                <Divider />

                {/* Результат */}
                {selectedId === null && (
                    <div className="text-center py-8 text-default-400">
                        <p className="text-lg">Выберите сотрудника из списка</p>
                        <p className="text-sm mt-2">Без выбора сотрудника запрос не выполняется (SKIP)</p>
                    </div>
                )}

                {selectedId !== null && state.isInitialLoading && !state.hasData && (
                    <div className="text-center py-8 text-lg">
                        ⏳ Загрузка профиля сотрудника...
                    </div>
                )}

                {/* TData здесь — User | null, поэтому hasData ещё не гарантирует непустой профиль */}
                {state.hasData && state.data && (
                    <div className={cn('p-4 bg-default-100 rounded-lg', state.dataSource !== 'current' && 'animate-pulse opacity-75')}>
                        <p className="text-2xl mb-2">{state.data.avatar}</p>
                        <p className="font-semibold text-lg">{state.data.name}</p>
                        <p className="text-sm text-default-500">{state.data.email}</p>
                        <p className="text-sm text-default-400">{state.data.role}</p>

                        {state.dataSource === 'placeholder' && (
                            <p className="text-xs text-warning-600 mt-2">
                                🧩 placeholder — заглушка из placeholderData, в кэш не попадает
                            </p>
                        )}
                        {state.dataSource === 'previous' && (
                            <p className="text-xs text-primary-600 mt-2">
                                🕘 previous — профиль предыдущего сотрудника, пока грузится новый (SWR)
                            </p>
                        )}
                    </div>
                )}

                <Divider />
                <p className="text-xs text-default-400 text-center">
                    Без выбора сотрудника запрос не выполняется (SKIP).
                    Первый выбранный сотрудник показывается через placeholderData (dataSource: placeholder),
                    а при следующем переключении на экране остаётся предыдущий профиль (dataSource: previous).
                </p>
            </CardBody>
        </Card>
    );
}
