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

const mockTodoList: TodoList = {
    items: [
        { id: 1, text: 'Иванов А. — отпуск 15–29 июля', completed: false },
        { id: 2, text: 'Петрова М. — больничный 3 августа', completed: true },
        { id: 3, text: 'Сидоров К. — отпуск 1–14 сентября', completed: false },
        { id: 4, text: 'Козлова Е. — отгул 20 августа', completed: false },
    ],
};

const api = createApi({
    plugins: [reactHooksPlugin()],
});

const todoResource = api.createResource<void, TodoList>({
    key: 'todo-patches',
    queryFn: async () => {
        await new Promise(resolve => setTimeout(resolve, 800));
        return JSON.parse(JSON.stringify(mockTodoList));
    },
});

interface PatchDemoItem {
    id: string;
    name: string;
    handle: { commit: () => void; abort: () => void };
}

let nextId = 1;

export function Base() {
    const state = todoResource.useResource();
    const [patches, setPatches] = React.useState<PatchDemoItem[]>([]);
    const { isRefreshError } = state;

    const applyPatch = (patchName: string, patchFn: (data: TodoList) => void) => {
        const handle = todoResource.getEntry()?.createPatch(patchFn);
        if (!handle) {
            console.warn('Заявка не создана — нет данных');
            return;
        }

        const patchId = `patch-${nextId++}`;
        setPatches(prev => [...prev, { id: patchId, name: patchName, handle }]);
    };

    const commitPatch = (patchId: string) => {
        setPatches(prev => prev.filter(p => {
            if (p.id === patchId) {
                p.handle.commit();
                return false;
            }
            return true;
        }));
    };

    const abortPatch = (patchId: string) => {
        setPatches(prev => prev.filter(p => {
            if (p.id === patchId) {
                p.handle.abort();
                return false;
            }
            return true;
        }));
    };

    const handleToggleItem = (item: TodoItem) => {
        applyPatch(`Согласовать "${item.text}"`, (draft) => {
            const target = draft.items.find(i => i.id === item.id);
            if (target) target.completed = !target.completed;
        });
    };

    const handleAddItem = () => {
        const text = prompt('Введите описание заявки:');
        if (!text) return;

        applyPatch(`Заявка: "${text}"`, (draft) => {
            const maxId = Math.max(...draft.items.map(i => i.id), 0);
            draft.items.push({ id: maxId + 1, text, completed: false });
        });
    };

    if (state.isInitialLoading) {
        return (
            <Card className="max-w-4xl">
                <CardBody className="text-center py-8">
                    <div className="text-lg">⏳ Загрузка заявок...</div>
                </CardBody>
            </Card>
        );
    }

    const data = state.data;
    if (!data) return null;

    return (
        <div className="flex flex-col gap-4">
            <Card className="flex-1">
                <CardHeader className="flex justify-between items-center">
                    <h3 className="text-xl font-bold">📝 Заявки на отпуск </h3>
                    <div className="flex gap-2 items-center">
                        <span className={`px-2 py-1 rounded text-xs font-mono ${isRefreshError ? 'bg-danger-100 text-danger-700' : 'bg-default-100 text-default-400'}`}>
                            isRefreshError: {String(isRefreshError)}
                        </span>
                        <Button color="primary" size="sm" onPress={handleAddItem}>
                            ➕ Новая заявка
                        </Button>
                    </div>
                </CardHeader>
                <Divider />
                <CardBody className="space-y-2">
                    {data.items.map((item: TodoItem) => (
                        <div
                            key={item.id}
                            className="flex items-center gap-3 p-3 bg-default-100 rounded-lg"
                        >
                            <Checkbox
                                isSelected={item.completed}
                                onValueChange={() => handleToggleItem(item)}
                            />
                            <span className={`flex-1 ${item.completed ? 'line-through text-default-400' : ''}`}>
                                {item.text}
                            </span>
                        </div>
                    ))}
                </CardBody>
            </Card>

            <Card className="flex-1">
                <CardHeader>
                    <h3 className="text-xl font-bold">🔧 Ожидают подтверждения </h3>
                </CardHeader>
                <Divider />
                <CardBody className="space-y-3">
                    <p className="text-sm text-default-500">
                        Каждая заявка создаёт патч через ref.createPatch(). Подтвердите (commit) или отмените (abort).
                    </p>

                    {patches.length === 0 && (
                        <div className="text-center py-8 text-default-400 italic">
                            Нет ожидающих заявок
                        </div>
                    )}

                    {patches.map(patch => (
                        <div
                            key={patch.id}
                            className="p-3 bg-default-100 rounded-lg space-y-2"
                        >
                            <p className="text-sm font-medium">{patch.name}</p>
                            <div className="flex gap-2">
                                <Button
                                    size="sm"
                                    color="success"
                                    variant="flat"
                                    onPress={() => commitPatch(patch.id)}
                                    className="flex-1"
                                >
                                    ✅ Подтвердить
                                </Button>
                                <Button
                                    size="sm"
                                    color="danger"
                                    variant="flat"
                                    onPress={() => abortPatch(patch.id)}
                                    className="flex-1"
                                >
                                    ❌ Отменить
                                </Button>
                            </div>
                        </div>
                    ))}
                </CardBody>
            </Card>
        </div>
    );
}
