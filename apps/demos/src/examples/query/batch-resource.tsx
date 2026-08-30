import { createApi, reactHooksPlugin, Signal, useSignal } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Checkbox, Chip, Divider } from '@heroui/react';
import React from 'react';
import { fetches } from "../../utils/fetches";

const api = createApi({
    plugins: [reactHooksPlugin()],
});

// Журнал сетевых запросов — чтобы видеть, какие id реально уходят в сеть
const requestLog$ = Signal.state<string[]>([]);

const usersResource = api.createResource({
    key: 'batch-users',
    queryFn: async (args: { userIds: number[] }) => {
        requestLog$.set([...requestLog$.peek(), `→ ids: [${args.userIds.join(', ')}]`]);
        return fetches.getUsersByIds(args);
    },
});

// Batch-обёртка: кэширует каждого пользователя отдельно
// и догружает через usersResource только недостающие id
const usersBatch = api.createBatchResource({
    resource: usersResource,
    key: 'users-batch',
    parseData: (users) => users.map((item) => ({ id: item.id, item })),
    makeArgs: (ids) => ({ userIds: ids }),
});

const TEAM = [
    { id: 1, name: 'Алексей' },
    { id: 2, name: 'Мария' },
    { id: 3, name: 'Иван' },
    { id: 4, name: 'Елена' },
    { id: 5, name: 'Дмитрий' },
];

export function Base() {
    const [selected, setSelected] = React.useState<number[]>([1, 2, 3]);
    const ids = React.useMemo(() => [...selected].sort((a, b) => a - b), [selected]);

    const state = usersBatch.useResource(ids);
    const log = useSignal(requestLog$);

    const toggle = (id: number, isOn: boolean) => {
        setSelected((prev) => (isOn ? [...prev, id] : prev.filter((x) => x !== id)));
    };

    const handleRefresh = () => usersBatch.refresh(ids);

    const handleReset = () => {
        api.resetAll();
        requestLog$.set([]);
    };

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                👥 Профили команды (batch-ресурс)
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                <div className="flex flex-wrap gap-3">
                    {TEAM.map((member) => (
                        <Checkbox
                            key={member.id}
                            isSelected={selected.includes(member.id)}
                            onValueChange={(isOn) => toggle(member.id, isOn)}
                        >
                            {member.name}
                        </Checkbox>
                    ))}
                </div>

                <Divider />

                {state.isLoading && (
                    <div className="text-sm text-default-500">⏳ Загрузка...</div>
                )}

                {state.data && (
                    <div className="space-y-2">
                        {state.data.map((user) => (
                            <div key={user.id} className="p-3 bg-default-100 rounded-lg flex items-center gap-3">
                                <span className="text-2xl">{user.avatar}</span>
                                <div>
                                    <p className="font-semibold">{user.name}</p>
                                    <p className="text-sm text-default-500">{user.role}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <Divider />

                <div className="flex items-center gap-2">
                    <Chip size="sm" variant="flat" color="primary">
                        Запросов в сеть: {log.length}
                    </Chip>
                    <Button size="sm" variant="flat" onPress={handleRefresh}>
                        🔄 Обновить выбранных
                    </Button>
                    <Button size="sm" variant="flat" color="warning" onPress={handleReset}>
                        🗑 Сбросить кэш
                    </Button>
                </div>

                {log.length > 0 && (
                    <div className="p-2 bg-default-50 rounded-lg font-mono text-xs space-y-1">
                        {log.map((line, index) => (
                            <div key={index}>{line}</div>
                        ))}
                    </div>
                )}

                <p className="text-xs text-default-400">
                    Меняйте выбор: в журнале видно, что в сеть уходят только id,
                    которых ещё нет в кэше элементов. «Обновить» перезапрашивает
                    все выбранные id, минуя кэш.
                </p>
            </CardBody>
        </Card>
    );
}
