import React from 'react';
import { Button, Card, CardBody, CardHeader, Checkbox, Divider } from '@heroui/react';
import { queryV2 } from '@fozy-labs/rx-toolkit';

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
        { id: 1, text: 'Изучить RxToolkit v2', completed: false },
        { id: 2, text: 'Попробовать оптимистичные патчи', completed: true },
        { id: 3, text: 'Добавить SSR snapshots', completed: false },
        { id: 4, text: 'Мигрировать с v1 на v2', completed: false },
    ],
};

const api = queryV2.createApi({
    plugins: [new queryV2.ReactHooksPlugin()],
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
    const state = todoResource.useResourceV2Agent(undefined);
    const ref = todoResource.useResourceV2Ref(undefined);
    const [patches, setPatches] = React.useState<PatchDemoItem[]>([]);

    const applyPatch = (patchName: string, patchFn: (data: TodoList) => void) => {
        const handle = ref.createPatch(patchFn);
        if (!handle) {
            console.warn('Патч не создан — нет данных');
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
        applyPatch(`Переключить "${item.text}"`, (draft) => {
            const target = draft.items.find(i => i.id === item.id);
            if (target) target.completed = !target.completed;
        });
    };

    const handleAddItem = () => {
        const text = prompt('Введите текст новой задачи:');
        if (!text) return;

        applyPatch(`Добавить: "${text}"`, (draft) => {
            const maxId = Math.max(...draft.items.map(i => i.id), 0);
            draft.items.push({ id: maxId + 1, text, completed: false });
        });
    };

    if (state.isInitialLoading) {
        return (
            <Card className="max-w-4xl">
                <CardBody className="text-center py-8">
                    <div className="text-lg">⏳ Загрузка задач...</div>
                </CardBody>
            </Card>
        );
    }

    if (state.isError) {
        return (
            <Card className="max-w-4xl">
                <CardBody className="text-center py-8 text-danger">
                    ❌ Ошибка: {state.error?.toString()}
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
                    <h3 className="text-xl font-bold">📝 Оптимистичные патчи (Query v2)</h3>
                    <Button color="primary" size="sm" onPress={handleAddItem}>
                        ➕ Добавить
                    </Button>
                </CardHeader>
                <Divider />
                <CardBody className="space-y-2">
                    {data.items.map(item => (
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
                    <h3 className="text-xl font-bold">🔧 Панель патчей (v2)</h3>
                </CardHeader>
                <Divider />
                <CardBody className="space-y-3">
                    <p className="text-sm text-default-500">
                        Каждое изменение создаёт патч через ref.createPatch(). Подтвердите (commit) или отмените (abort).
                    </p>

                    {patches.length === 0 && (
                        <div className="text-center py-8 text-default-400 italic">
                            Нет активных патчей
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
