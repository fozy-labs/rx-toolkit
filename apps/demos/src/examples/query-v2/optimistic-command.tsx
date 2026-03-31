import React from 'react';
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Checkbox, Divider } from '@heroui/react';

interface TodoItem {
    id: number;
    text: string;
    completed: boolean;
}

interface TodoList {
    items: TodoItem[];
}

const serverTodos: TodoItem[] = [
    { id: 1, text: 'Изучить RxToolkit v2', completed: false },
    { id: 2, text: 'Попробовать оптимистичные обновления', completed: true },
    { id: 3, text: 'Написать документацию', completed: false },
    { id: 4, text: 'Мигрировать с v1 на v2', completed: false },
];

const api = unstable_queryV2.createApi({
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

const todosResource = api.createResourceV2<void, TodoList>({
    key: 'optimistic-command-todos',
    queryFn: async () => {
        await new Promise(resolve => setTimeout(resolve, 800));
        return { items: serverTodos.map((t: TodoItem) => ({ ...t })) };
    },
});

let shouldFail = false;

const toggleTodoCommand = api.createCommandV2<{ id: number; completed: boolean }, { id: number; completed: boolean }>({
    queryFn: async (args) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (shouldFail) {
            shouldFail = false;
            throw new Error('Сервер недоступен');
        }
        const item = serverTodos.find(t => t.id === args.id);
        if (item) item.completed = args.completed;
        return args;
    },
    link: [
        unstable_queryV2.commandLink({
            resource: todosResource,
            forwardArgs: () => undefined,
            invalidate: true,
            optimisticUpdate: ({ draft, args }) => {
                const item = draft.items.find((t: TodoItem) => t.id === args.id);
                if (item) item.completed = args.completed;
            },
        }),
    ],
});

export function Base() {
    const resourceState = todosResource.useResourceV2Agent();
    const [trigger, commandState] = toggleTodoCommand.useCommandV2Agent();
    const [lastAction, setLastAction] = React.useState<string | null>(null);

    const handleToggle = async (item: TodoItem) => {
        const newCompleted = !item.completed;
        setLastAction(`Переключение "${item.text}" → ${newCompleted ? '✅' : '⬜'}`);
        try {
            await trigger({ id: item.id, completed: newCompleted });
            setLastAction(`✅ Подтверждено: "${item.text}" → ${newCompleted ? 'выполнено' : 'не выполнено'}`);
        } catch {
            setLastAction(`❌ Откат: "${item.text}" — сервер вернул ошибку`);
        }
    };

    const handleToggleError = () => {
        shouldFail = true;
    };

    if (resourceState.isInitialLoading) {
        return (
            <Card>
                <CardBody className="text-center py-8">
                    <div className="text-lg">⏳ Загрузка задач...</div>
                </CardBody>
            </Card>
        );
    }

    const data = resourceState.data;
    if (!data) return null;

    return (
        <div className="flex flex-col gap-4">
            <Card>
                <CardHeader className="flex justify-between items-center">
                    <h3 className="text-xl font-bold">⚡ Оптимистичная команда (CommandV2)</h3>
                    <Button
                        size="sm"
                        color="danger"
                        variant="flat"
                        onPress={handleToggleError}
                    >
                        💥 Следующая — ошибка
                    </Button>
                </CardHeader>
                <Divider />
                <CardBody className="space-y-4">
                    {/* Состояние команды */}
                    <div className="flex gap-2 flex-wrap">
                        <span className={`px-2 py-1 rounded text-xs font-mono ${commandState.isLoading ? 'bg-warning-100 text-warning-700' : 'bg-default-100 text-default-400'}`}>
                            isLoading: {String(commandState.isLoading)}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs font-mono ${commandState.isSuccess ? 'bg-success-100 text-success-700' : 'bg-default-100 text-default-400'}`}>
                            isSuccess: {String(commandState.isSuccess)}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs font-mono ${commandState.isError ? 'bg-danger-100 text-danger-700' : 'bg-default-100 text-default-400'}`}>
                            isError: {String(commandState.isError)}
                        </span>
                        <span className="px-2 py-1 rounded text-xs font-mono bg-default-100 text-default-500">
                            status: {commandState.status}
                        </span>
                    </div>

                    {/* Последнее действие */}
                    {lastAction && (
                        <div className={`p-3 rounded-lg text-sm ${
                            lastAction.startsWith('❌') ? 'bg-danger-50 text-danger-700' :
                            lastAction.startsWith('✅') ? 'bg-success-50 text-success-700' :
                            'bg-warning-50 text-warning-700'
                        }`}>
                            {lastAction}
                        </div>
                    )}

                    {/* Список задач */}
                    <div className="space-y-2">
                        {data.items.map((item: TodoItem) => (
                            <div
                                key={item.id}
                                className="flex items-center gap-3 p-3 bg-default-100 rounded-lg"
                            >
                                <Checkbox
                                    isSelected={item.completed}
                                    onValueChange={() => handleToggle(item)}
                                    isDisabled={commandState.isLoading}
                                />
                                <span className={`flex-1 ${item.completed ? 'line-through text-default-400' : ''}`}>
                                    {item.text}
                                </span>
                                <span className="text-xs text-default-400">#{item.id}</span>
                            </div>
                        ))}
                    </div>

                    <Divider />
                    <p className="text-xs text-default-400 text-center">
                        optimisticUpdate обновляет UI мгновенно. При ошибке — автоматический откат. Нажмите «Следующая — ошибка» перед переключением.
                    </p>
                </CardBody>
            </Card>
        </div>
    );
}
