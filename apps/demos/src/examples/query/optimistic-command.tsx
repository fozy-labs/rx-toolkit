import React from 'react';
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';
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
    { id: 1, text: 'Обзор нового API', completed: false },
    { id: 2, text: 'Гайд по миграции', completed: true },
    { id: 3, text: 'Советы по производительности', completed: false },
    { id: 4, text: 'Сравнение фреймворков', completed: false },
];

const api = createApi({
    plugins: [reactHooksPlugin()],
});

const todosResource = api.createResource<void, TodoList>({
    key: 'optimistic-command-todos',
    queryFn: async () => {
        await new Promise(resolve => setTimeout(resolve, 800));
        return { items: serverTodos.map((t: TodoItem) => ({ ...t })) };
    },
});

let shouldFail = false;

const toggleTodoCommand = api.createCommand<{ id: number; completed: boolean }, { id: number; completed: boolean }>({
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
    links: (link) => link({
        resource: todosResource,
        forwardArgs: () => undefined,
        invalidate: true,
        optimisticUpdate: (draft: TodoList, args: { id: number; completed: boolean }) => {
            const item = draft.items.find((t: TodoItem) => t.id === args.id);
            if (item) item.completed = args.completed;
        },
    }),
});

export function Base() {
    const resourceState = todosResource.useResource();
    const [trigger, commandState] = toggleTodoCommand.useCommand();
    const [lastAction, setLastAction] = React.useState<string | null>(null);

    const handleToggle = async (item: TodoItem) => {
        const newCompleted = !item.completed;
        setLastAction(`Модерация "${item.text}" → ${newCompleted ? '✅ публикация' : '⬜ снятие'}`);
        try {
            await trigger({ id: item.id, completed: newCompleted });
            setLastAction(`✅ Подтверждено: "${item.text}" → ${newCompleted ? 'опубликовано' : 'снято с публикации'}`);
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
                    <div className="text-lg">⏳ Загрузка публикаций...</div>
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
                    <h3 className="text-xl font-bold">⚡ Модерация контента</h3>
                    <Button
                        size="sm"
                        color="danger"
                        variant="flat"
                        onPress={handleToggleError}
                    >
                        💥 Имитировать сбой
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
                        Решение модератора применяется мгновенно (optimisticUpdate). При ошибке — автоматический откат. Нажмите «Имитировать сбой» перед переключением.
                    </p>
                </CardBody>
            </Card>
        </div>
    );
}
