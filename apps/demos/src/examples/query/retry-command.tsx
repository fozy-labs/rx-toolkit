import React from 'react';
import { createApi, reactHooksPlugin, Signal, useSignal } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Chip, Divider } from '@heroui/react';

interface Attempt {
    requestId: string;
    orderId: number;
    charged: boolean;
}

// ── Фейковый «сервер» оплаты с дедупом по requestId ──
// Сервер запоминает обработанные requestId, поэтому повтор с тем же id
// возвращает прежний результат и НЕ списывает деньги второй раз.
const processedPayments = new Map<string, { orderId: number }>();
let nextOrderId = 1001;
let loseNextResponse = false;

let attemptsLog: Attempt[] = [];
const attemptsLog$ = Signal.state<Attempt[]>([]);
const lastRequestId$ = Signal.state<string | null>(null);

function pushAttempt(attempt: Attempt) {
    attemptsLog = [...attemptsLog, attempt];
    attemptsLog$.set(attemptsLog);
}

const api = createApi({
    plugins: [reactHooksPlugin()],
});

const payCommand = api.createCommand<{ amount: number }, { orderId: number }>({
    // requestId — второй аргумент queryFn. Он стабилен между ретраями одной
    // кэш-записи, поэтому его отправляют на бэкенд как ключ идемпотентности.
    queryFn: async (args, requestId) => {
        lastRequestId$.set(requestId);
        await new Promise(resolve => setTimeout(resolve, 700));

        let record = processedPayments.get(requestId);
        const charged = record == null;
        if (!record) {
            // Первый раз видим этот requestId — «списываем» средства.
            record = { orderId: nextOrderId++ };
            processedPayments.set(requestId, record);
        }

        pushAttempt({ requestId, orderId: record.orderId, charged });

        if (loseNextResponse) {
            loseNextResponse = false;
            // Деньги уже списаны, но ответ «потерялся» в сети.
            throw new Error('Таймаут сети — ответ не получен');
        }

        return { orderId: record.orderId };
    },
});

export function Base() {
    const [pay, state] = payCommand.useCommand();
    const lastRequestId = useSignal(lastRequestId$);
    const attempts = useSignal(attemptsLog$);

    const realCharges = attempts.filter(a => a.charged).length;

    const handlePay = () => {
        pay({ amount: 100 }).catch(() => {
            // Ошибка отражается реактивно через state.isError.
        });
    };

    const handleBreak = () => {
        loseNextResponse = true;
    };

    return (
        <Card>
            <CardHeader className="flex justify-between items-center">
                <h3 className="text-xl font-bold">💳 Оплата заказа</h3>
                <Button size="sm" color="danger" variant="flat" onPress={handleBreak}>
                    💥 Потерять ответ
                </Button>
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                {/* Состояние команды */}
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
                </div>

                {/* requestId и счётчики */}
                <div className="text-sm space-y-1">
                    <div>
                        requestId:{' '}
                        <span className="font-mono text-xs">{lastRequestId ?? '—'}</span>
                    </div>
                    <div className="flex gap-4">
                        <span>Попыток: <b>{attempts.length}</b></span>
                        <span>Реальных списаний: <b className="text-success-700">{realCharges}</b></span>
                    </div>
                </div>

                {/* Управление */}
                <div className="flex gap-2">
                    <Button color="primary" size="sm" onPress={handlePay} isLoading={state.isLoading}>
                        Оплатить 100 ₽
                    </Button>
                    {state.isError && (
                        <Button color="warning" size="sm" variant="flat" onPress={state.retry}>
                            ↻ Повторить (тот же requestId)
                        </Button>
                    )}
                </div>

                {/* Ошибка */}
                {state.isError && (
                    <div className="p-3 bg-danger-50 text-danger-700 rounded-lg text-sm">
                        Ошибка: {String(state.error)}. Деньги уже списаны — «Повторить» переотправит запрос
                        с тем же requestId, и сервер вернёт прежний результат без повторного списания.
                    </div>
                )}

                {/* Успех */}
                {state.isSuccess && state.data && (
                    <div className="p-3 bg-success-50 text-success-700 rounded-lg text-sm">
                        ✅ Оплачено. Заказ #{state.data.orderId}
                    </div>
                )}

                {/* Журнал попыток */}
                {attempts.length > 0 && (
                    <div className="space-y-1">
                        {attempts.map((a, i) => (
                            <div key={i} className="flex items-center gap-2 p-2 bg-default-100 rounded text-xs font-mono">
                                <Chip size="sm" color={a.charged ? 'success' : 'default'} variant="flat">
                                    {a.charged ? 'списание' : 'дедуп'}
                                </Chip>
                                <span>#{a.orderId}</span>
                                <span className="text-default-400 truncate">{a.requestId.slice(0, 8)}…</span>
                            </div>
                        ))}
                    </div>
                )}

                <Divider />
                <p className="text-xs text-default-400 text-center">
                    queryFn(args, requestId) — второй аргумент стабилен между ретраями. Нажмите «Потерять ответ»,
                    затем «Оплатить»: запрос упадёт уже после списания. «Повторить» (retry) дедупится по requestId —
                    второго списания не происходит. А новый «Оплатить» создаёт новый requestId и новое списание.
                </p>
            </CardBody>
        </Card>
    );
}
