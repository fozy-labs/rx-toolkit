import { createResource, useResourceAgent, useResourceRef } from '@fozy-labs/rx-toolkit';
import { useState } from 'react';
import { Button, Card, CardBody, CardHeader, Checkbox, Divider, Select, SelectItem } from '@heroui/react';

interface TodoItem {
    id: number;
    text: string;
    completed: boolean;
    priority: 'low' | 'medium' | 'high';
}

interface TodoList {
    items: TodoItem[];
}

const mockTodoList: TodoList = {
    items: [
        { id: 1, text: 'Изучить RxToolkit', completed: false, priority: 'high' },
        { id: 2, text: 'Написать документацию', completed: true, priority: 'medium' },
        { id: 3, text: 'Добавить тесты', completed: false, priority: 'low' },
        { id: 4, text: 'Оптимизировать производительность', completed: false, priority: 'medium' }
    ],
};

const fetchTodoList = async (): Promise<TodoList> => {
    await new Promise(resolve => setTimeout(resolve, 800));
    return JSON.parse(JSON.stringify(mockTodoList));
};

export const todoListResource = createResource({
    queryFn: fetchTodoList,
});

interface PatchDemoItem {
    id: string;
    name: string;
    transaction: any;
    status: 'pending' | 'committed' | 'aborted';
}

let nextIdRef = { current: 1 };

export function Base() {
    const todoQuery = useResourceAgent(todoListResource, undefined);
    const todoRef = useResourceRef(todoListResource, undefined);
    const [patches, setPatches] = useState<PatchDemoItem[]>([]);

    const createPatch = (patchName: string, patchFn: (data: TodoList) => void) => {
        if (!todoRef) throw new Error('Resource reference is not available');
        const transaction = todoRef.patch(patchFn);
        if (!transaction) {
            console.warn('Transaction was not created');
            return;
        }

        const nextId = nextIdRef.current;
        nextIdRef.current += 1;
        const patchId = `patch-${nextId}`;

        const newPatch: PatchDemoItem = {
            id: patchId,
            name: patchName,
            transaction,
            status: 'pending'
        };

        setPatches(prev => [...prev, newPatch]);
    };

    const commitPatch = (patchId: string) => {
        const newPatches = patches.filter(patch => {
            if (patch.id === patchId) {
                patch.transaction.commit();
                return false;
            }
            return true;
        });
        setPatches(newPatches);
    };

    const abortPatch = (patchId: string) => {
        const newPatches = patches.filter(patch => {
            if (patch.id === patchId) {
                patch.transaction.abort();
                return false;
            }
            return true;
        });
        setPatches(newPatches);
    };

    const handleToggleItem = (tm: TodoItem) => {
        createPatch(`Переключить задачу "${tm.text}"`, (draft) => {
            const item = draft.items.find(i => i.id === tm.id);
            if (item) {
                item.completed = !item.completed;
            }
        });
    };

    const handleChangePriority = (tm: TodoItem, priority: 'low' | 'medium' | 'high') => {
        createPatch(`Изменить приоритет задачи "${tm.text}" на ${priority}`, (draft) => {
            const item = draft.items.find(i => i.id === tm.id);
            if (item) {
                item.priority = priority;
            }
        });
    };

    const handleAddItem = () => {
        const newItemText = prompt('Введите текст новой задачи:');
        if (!newItemText) return;

        createPatch(`Добавить задачу: "${newItemText}"`, (draft) => {
            const maxId = Math.max(...draft.items.map(i => i.id), 0);
            draft.items.push({
                id: maxId + 1,
                text: newItemText,
                completed: false,
                priority: 'medium'
            });
        });
    };

    if (todoQuery.isLoading) {
        return (
            <Card className="max-w-4xl">
                <CardBody className="text-center py-8">
                    <div className="text-lg">⏳ Загрузка списка задач...</div>
                </CardBody>
            </Card>
        );
    }

    if (todoQuery.isError) {
        return (
            <Card className="max-w-4xl">
                <CardBody className="text-center py-8 text-danger">
                    ❌ Ошибка: {todoQuery.error?.toString()}
                </CardBody>
            </Card>
        );
    }

    const data = todoQuery.data;
    if (!data) return null;

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'high': return 'danger';
            case 'medium': return 'warning';
            case 'low': return 'success';
            default: return 'default';
        }
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Список задач */}
            <Card className="flex-1">
                <CardHeader className="flex justify-between items-center">
                    <h3 className="text-xl font-bold">📝 Список задач</h3>
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
                            <Select
                                aria-label="Приоритет"
                                size="sm"
                                className="w-32"
                                selectedKeys={[item.priority]}
                                onChange={(e) => handleChangePriority(item, e.target.value as any)}
                                color={getPriorityColor(item.priority)}
                            >
                                <SelectItem key="low">Низкий</SelectItem>
                                <SelectItem key="medium">Средний</SelectItem>
                                <SelectItem key="high">Высокий</SelectItem>
                            </Select>
                        </div>
                    ))}
                </CardBody>
            </Card>

            {/* Панель патчей */}
            <Card className="flex-1">
                <CardHeader>
                    <h3 className="text-xl font-bold">🔧 Панель патчей</h3>
                </CardHeader>
                <Divider />
                <CardBody className="space-y-3">
                    <p className="text-sm text-default-500">
                        Каждое изменение создает патч, который можно подтвердить или отменить
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

