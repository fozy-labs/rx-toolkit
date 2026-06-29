import React from 'react';
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Chip, cn, Divider, Spinner } from '@heroui/react';
import { fetches } from '../../utils/fetches';

/**
 * Prefetch on hover — предзагрузка данных по наведению курсора (без роутера).
 *
 * Классический приём «hover → prefetch → instant open»:
 *   - onMouseEnter по карточке вызывает resource.prefetch(id) — тихо греет кэш.
 *     prefetch НЕ абортится при уходе курсора и НИКОГДА не реджектит (fire-and-forget),
 *     поэтому спекулятивная загрузка переживает «навигацию».
 *   - Клик монтирует панель профиля через useResource(id). Если кэш уже прогрет —
 *     данные показываются мгновенно (без спиннера), в пределах окна retention.
 *   - Клик без наведения → холодная загрузка ~1с со спиннером.
 *
 * Контраст «мгновенно из кэша» vs «загрузка с сервера» виден по замеру времени
 * от монтирования панели до появления данных.
 */

const api = createApi({
    plugins: [reactHooksPlugin()],
});

const userResource = api.createResource({
    key: 'prefetch-on-hover-user',
    queryFn: fetches.getUser,
});

const userIds = [1, 2, 3, 4, 5];
const userLabels: Record<number, string> = {
    1: 'Алексей И.',
    2: 'Мария П.',
    3: 'Иван С.',
    4: 'Елена К.',
    5: 'Дмитрий С.',
};

type WarmStatus = 'warming' | 'warm';

/** Панель профиля. key={id} → свежий монтаж на каждый выбор (без SWR-переноса). */
function UserDetail({ id }: { id: number }) {
    const state = userResource.useResource(id);

    // Замер: сколько прошло от монтирования до первого успешного рендера.
    const startRef = React.useRef(performance.now());
    const [elapsedMs, setElapsedMs] = React.useState<number | null>(null);

    React.useEffect(() => {
        if (state.isSuccess && elapsedMs === null) {
            setElapsedMs(Math.round(performance.now() - startRef.current));
        }
    }, [state.isSuccess, elapsedMs]);

    if (state.isInitialLoading) {
        return (
            <div className="flex items-center gap-3 py-8 justify-center text-default-500">
                <Spinner size="sm" />
                <span>🌐 Загрузка профиля с сервера…</span>
            </div>
        );
    }

    if (!state.data) {
        return <div className="py-8 text-center text-default-400">Сотрудник не найден</div>;
    }

    const wasInstant = elapsedMs !== null && elapsedMs < 50;

    return (
        <div className="p-4 bg-default-100 rounded-lg space-y-2">
            <p className="text-3xl">{state.data.avatar}</p>
            <p className="font-semibold text-lg">{state.data.name}</p>
            <p className="text-sm text-default-500">{state.data.email}</p>
            <p className="text-sm text-default-400">{state.data.role}</p>

            {elapsedMs !== null && (
                <Chip
                    size="sm"
                    color={wasInstant ? 'success' : 'default'}
                    variant="flat"
                >
                    {wasInstant ? `⚡ мгновенно из кэша (${elapsedMs} мс)` : `🌐 загружено с сервера (${elapsedMs} мс)`}
                </Chip>
            )}
        </div>
    );
}

export function Base() {
    const [selectedId, setSelectedId] = React.useState<number | null>(null);

    // Отображаемый статус прогрева по каждому id (cold = отсутствует в объекте).
    const [warmStatus, setWarmStatus] = React.useState<Record<number, WarmStatus>>({});
    // Защита от повторного prefetch на каждое наведение (ref, не вызывает ререндер).
    const touched = React.useRef<Set<number>>(new Set());

    const handlePrefetch = (id: number) => {
        if (touched.current.has(id)) return; // уже греется или прогрет
        touched.current.add(id);

        setWarmStatus((prev) => ({ ...prev, [id]: 'warming' }));

        // fire-and-forget: prefetch не реджектит, ждать результат не обязательно.
        void userResource.prefetch(id).then(() => {
            setWarmStatus((prev) => ({ ...prev, [id]: 'warm' }));
        });
    };

    const handleReset = () => {
        api.resetAll();
        touched.current = new Set();
        setWarmStatus({});
        setSelectedId(null);
    };

    return (
        <Card>
            <CardHeader className="text-xl font-bold">🗂 Сотрудники — наведи, чтобы предзагрузить</CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                <div className="p-3 bg-primary-50 border border-primary-200 rounded-lg text-sm space-y-1">
                    <p>
                        Наведите курсор на карточку → <span className="font-mono font-semibold">resource.prefetch(id)</span>{' '}
                        тихо греет кэш.
                    </p>
                    <p>Затем кликните — профиль откроется мгновенно. Кликните без наведения — увидите загрузку.</p>
                </div>

                <div className="space-y-2">
                    {userIds.map((id) => {
                        const status = warmStatus[id];
                        return (
                            <button
                                key={id}
                                type="button"
                                onMouseEnter={() => handlePrefetch(id)}
                                onFocus={() => handlePrefetch(id)}
                                onClick={() => setSelectedId(id)}
                                className={cn(
                                    'w-full flex items-center justify-between gap-3 p-3 rounded-lg text-left transition-colors',
                                    selectedId === id ? 'bg-primary-100 ring-1 ring-primary-300' : 'bg-default-100 hover:bg-default-200',
                                )}
                            >
                                <span className="font-medium">👤 {userLabels[id]}</span>
                                <Chip
                                    size="sm"
                                    variant="flat"
                                    color={status === 'warm' ? 'success' : status === 'warming' ? 'warning' : 'default'}
                                >
                                    {status === 'warm' ? '⚡ в кэше' : status === 'warming' ? '⏳ предзагрузка…' : 'наведи мышку'}
                                </Chip>
                            </button>
                        );
                    })}
                </div>

                <Divider />

                {selectedId === null ? (
                    <div className="text-center py-8 text-default-400">
                        <p className="text-lg">Выберите сотрудника</p>
                        <p className="text-sm mt-2">Сравните открытие с предзагрузкой и без неё</p>
                    </div>
                ) : (
                    <UserDetail key={selectedId} id={selectedId} />
                )}

                <Divider />

                <Button color="warning" variant="flat" size="sm" onPress={handleReset} fullWidth>
                    🔄 Очистить кэш и статусы
                </Button>

                <p className="text-xs text-default-400 text-center">
                    prefetch не абортится и не реджектит — спекулятивная загрузка переживает уход курсора.
                    Прогретая запись живёт в кэше в окне retention, поэтому клик после наведения открывает профиль мгновенно.
                </p>
            </CardBody>
        </Card>
    );
}
