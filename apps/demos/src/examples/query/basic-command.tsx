import React from 'react';
import { createApi, ReactHooksPlugin, commandLink } from '@fozy-labs/rx-toolkit';
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
    { id: 1, text: 'Изучить RxToolkit' },
    { id: 2, text: 'Попробовать Command' },
    { id: 3, text: 'Написать тесты' },
    { id: 4, text: 'Провести код-ревью' },
    { id: 5, text: 'Развернуть на продакшен' },
];

const api = createApi({
    plugins: [new ReactHooksPlugin()],
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
    link: [
        commandLink({
            resource: todosResource,
            forwardArgs: () => undefined as void,
            invalidate: true,
        }),
    ],
});

export function Base() {
    const resourceState = todosResource.useResourceAgent();
    const [trigger, commandState] = addTodoCommand.useCommandAgent();
    const [inputText, setInputText] = React.useState('');

    const handleAdd = async () => {
        const text = inputText.trim();
        if (!text) return;
        setInputText('');
        await trigger({ text });
    };

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                🚀 Базовая команда (Command)
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
                        placeholder="Новая задача..."
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
                        Добавить
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
                        ⏳ Загрузка задач...
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
                    createApi → createCommand + createResource → useCommandAgent — добавление элемента с инвалидацией ресурса
                </p>
            </CardBody>
        </Card>
    );
}
