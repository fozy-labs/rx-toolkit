import React from 'react';
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider, Input } from '@heroui/react';

interface TodoItem {
    id: number;
    text: string;
}

interface TodoList {
    items: TodoItem[];
}

let nextId = 6;
const serverTodos: TodoItem[] = [
    { id: 1, text: 'Заказ #1001 — Ноутбук Pro' },
    { id: 2, text: 'Заказ #1002 — Монитор 27"' },
    { id: 3, text: 'Заказ #1003 — Клавиатура механическая' },
    { id: 4, text: 'Заказ #1004 — Мышь беспроводная' },
    { id: 5, text: 'Заказ #1005 — Веб-камера HD' },
];

const api = createApi({
    plugins: [reactHooksPlugin()],
});

const todosResource = api.createResource<void, TodoList>({
    key: 'basic-command-todos',
    queryFn: async () => {
        await new Promise(resolve => setTimeout(resolve, 800));
        return { items: [...serverTodos] };
    },
});

const addTodoCommand = api.createCommand<{ text: string }, TodoItem>({
    queryFn: async (args) => {
        await new Promise(resolve => setTimeout(resolve, 600));
        const newItem: TodoItem = { id: nextId++, text: args.text };
        serverTodos.push(newItem);
        return newItem;
    },
    links: (link) => link({
        resource: todosResource,
        forwardArgs: () => undefined,
        invalidate: true,
    }),
});

export function Base() {
    const resourceState = todosResource.useResource();
    const [trigger, commandState] = addTodoCommand.useCommand();
    const [inputText, setInputText] = React.useState('');

    const handleAdd = async () => {
        const text = inputText.trim();
        if (!text) return;
        setInputText('');
        try {
            await trigger({ text });
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                � Управление заказами
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

                {/* Форма добавления */}
                <div className="flex gap-2">
                    <Input
                        size="sm"
                        placeholder="Новый заказ..."
                        value={inputText}
                        onValueChange={setInputText}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        isDisabled={commandState.isLoading}
                    />
                    <Button
                        color="primary"
                        size="sm"
                        onPress={handleAdd}
                        isLoading={commandState.isLoading}
                    >
                        Оформить
                    </Button>
                </div>

                {/* Ошибка */}
                {commandState.isError && (
                    <div className="p-3 bg-danger-50 text-danger-700 rounded-lg text-sm">
                        Ошибка: {String(commandState.error)}
                    </div>
                )}

                {/* Список */}
                {resourceState.isInitialLoading && (
                    <div className="text-center py-8 text-lg">
                        ⏳ Загрузка заказов...
                    </div>
                )}

                {resourceState.data && (
                    <div className="space-y-2">
                        {resourceState.data.items.map((item: TodoItem) => (
                            <div
                                key={item.id}
                                className="p-3 bg-default-100 rounded-lg"
                            >
                                <span className="font-medium">{item.text}</span>
                                <span className="text-xs text-default-400 ml-2">#{item.id}</span>
                            </div>
                        ))}
                    </div>
                )}

                <Divider />
                <p className="text-xs text-default-400 text-center">
                    createApi → createCommand + createResource → useCommand — оформление заказа с инвалидацией ресурса
                </p>
            </CardBody>
        </Card>
    );
}
