import React from 'react';
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider } from '@heroui/react';

interface Profile {
    id: number;
    name: string;
    role: string;
}

// ── Типизированные доменные ошибки ──
// mapError превращает любую сырую ошибку в один из этих классов. Литеральное
// поле kind делает их дискриминированным объединением: switch по нему сужает
// AppError до конкретного класса и открывает его типизированные поля.
class NetworkError extends Error {
    readonly kind = 'network';
    constructor() {
        super('Сеть недоступна — проверьте подключение');
        this.name = 'NetworkError';
    }
}

class NotFoundError extends Error {
    readonly kind = 'not-found';
    userId: number;
    constructor(userId: number) {
        super(`Профиль #${userId} не найден`);
        this.name = 'NotFoundError';
        this.userId = userId;
    }
}

class ServerError extends Error {
    readonly kind = 'server';
    status: number;
    constructor(status: number) {
        super(`Сбой на сервере (HTTP ${status})`);
        this.name = 'ServerError';
        this.status = status;
    }
}

type AppError = NetworkError | NotFoundError | ServerError;

// Каким будет следующий ответ «сервера» (управляется кнопками).
type Outcome = 'success' | 'not-found' | 'server' | 'network';
let nextOutcome: Outcome = 'success';

const api = createApi({
    plugins: [reactHooksPlugin()],
    // ── Единая точка нормализации ──
    // Вызывается ровно один раз на каждый провал — на границе machine.fail().
    // Сырую ошибку (HTTP-подобный объект или сетевой сбой) приводим к AppError.
    // Возвращаемый тип автоматически выводится в TError, поэтому state.error
    // на всех состояниях ресурсов/команд типизирован как AppError, а не unknown.
    mapError: (error, ctx): AppError => {
        // «HTTP-ответ» с полем status.
        if (typeof error === 'object' && error !== null && 'status' in error) {
            const status = Number((error as { status: number }).status);
            // ctx даёт провенанс: source ('query' | 'command'), args, entryKey, key.
            if (status === 404) return new NotFoundError(Number(ctx.args));
            return new ServerError(status);
        }
        // Всё остальное трактуем как сетевой сбой.
        return new NetworkError();
    },
});

const profileResource = api.createResource<number, Profile>({
    key: 'maperror-profile',
    queryFn: async (userId): Promise<Profile> => {
        await new Promise(resolve => setTimeout(resolve, 600));

        switch (nextOutcome) {
            case 'not-found':
                throw { status: 404 };
            case 'server':
                throw { status: 503 };
            case 'network':
                throw new TypeError('Failed to fetch');
            default:
                return { id: userId, name: 'Иван Петров', role: 'Senior Engineer' };
        }
    },
});

// Ветвление по типу ошибки — здесь виден смысл mapError: state.error уже
// AppError, а switch по дискриминанту kind сужает его до конкретного класса
// и его полей (instanceof тоже работает в обычной сборке).
function describeError(err: AppError): { icon: string; title: string; detail: string } {
    switch (err.kind) {
        case 'not-found':
            return { icon: '🔍', title: err.message, detail: `NotFoundError · userId=${err.userId}` };
        case 'server':
            return { icon: '🔥', title: err.message, detail: `ServerError · status=${err.status}` };
        default:
            return { icon: '📡', title: err.message, detail: 'NetworkError' };
    }
}

export function Base() {
    const state = profileResource.useResource(42);

    const run = (outcome: Outcome) => {
        nextOutcome = outcome;
        // refresh() валиден из success / refresh-error, retry() — из error.
        if (state.status === 'error') {
            state.retry();
        } else {
            state.refresh();
        }
    };

    const described = state.isError ? describeError(state.error) : null;

    return (
        <Card>
            <CardHeader className="text-xl font-bold">🧑‍💼 Профиль сотрудника</CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                {/* Состояние ресурса */}
                <div className="flex gap-2 flex-wrap">
                    <span className={`px-2 py-1 rounded text-xs font-mono ${state.isLoading ? 'bg-warning-100 text-warning-700' : 'bg-default-100 text-default-400'}`}>
                        isLoading: {String(state.isLoading)}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-mono ${state.isSuccess ? 'bg-success-100 text-success-700' : 'bg-default-100 text-default-400'}`}>
                        isSuccess: {String(state.isSuccess)}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-mono ${state.isError ? 'bg-danger-100 text-danger-700' : 'bg-default-100 text-default-400'}`}>
                        isError: {String(state.isError)}
                    </span>
                    <span className="px-2 py-1 rounded text-xs font-mono bg-default-100 text-default-500">
                        status: {state.status}
                    </span>
                </div>

                {/* Выбор следующего исхода «сервера» */}
                <div className="flex gap-2 flex-wrap">
                    <Button size="sm" color="success" variant="flat" isDisabled={state.isLoading} onPress={() => run('success')}>
                        ✅ Успех
                    </Button>
                    <Button size="sm" color="warning" variant="flat" isDisabled={state.isLoading} onPress={() => run('not-found')}>
                        404 Not Found
                    </Button>
                    <Button size="sm" color="danger" variant="flat" isDisabled={state.isLoading} onPress={() => run('server')}>
                        503 Server
                    </Button>
                    <Button size="sm" color="default" variant="flat" isDisabled={state.isLoading} onPress={() => run('network')}>
                        📡 Сеть
                    </Button>
                </div>

                {state.isInitialLoading && (
                    <div className="text-center py-8 text-lg">⏳ Загрузка профиля...</div>
                )}

                {/* Типизированная ошибка: рендер зависит от класса ошибки */}
                {described && (
                    <div className="p-3 bg-danger-50 border border-danger-200 rounded-lg">
                        <p className="text-danger-700 font-semibold">
                            {described.icon} {described.title}
                        </p>
                        <p className="text-xs text-danger-500 mt-1 font-mono">
                            state.error → {described.detail}
                        </p>
                        {state.data && (
                            <p className="text-xs text-default-500 mt-1">
                                Устаревшие данные сохранены (SWR): {state.data.name}
                            </p>
                        )}
                    </div>
                )}

                {/* Успешные данные */}
                {state.isSuccess && state.data && (
                    <div className="p-3 bg-success-50 rounded-lg">
                        <p className="font-semibold">{state.data.name}</p>
                        <p className="text-sm text-default-500">{state.data.role}</p>
                    </div>
                )}

                <Divider />
                <p className="text-xs text-default-400 text-center">
                    Один mapError на уровне API нормализует сырые ошибки в типизированный AppError.
                    Поле state.error больше не unknown — дискриминант kind сужает его до NotFoundError /
                    ServerError / NetworkError с их полями. Тот же экземпляр видят состояние хука, реджект
                    ensure()/fetch() и реджект trigger у мутаций.
                </p>
            </CardBody>
        </Card>
    );
}
