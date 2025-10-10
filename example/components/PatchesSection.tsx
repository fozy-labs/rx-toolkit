import { createResource, useResourceAgent, useResourceRef } from '@fozy-labs/rx-toolkit';
import React, { useState } from 'react';

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

export function PatchesSection() {
    const todoQuery = useResourceAgent(todoListResource, undefined);
    const todoRef = useResourceRef(todoListResource, undefined);
    const [patches, setPatches] = useState<PatchDemoItem[]>([]);
    const nextIdRef = React.useRef(1);

    const createPatch = (patchName: string, patchFn: (data: TodoList) => void) => {
        if (!todoRef) throw new Error('Resource reference is not available');
        const transaction = todoRef.patch(patchFn);
        if (!transaction) return;

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
        setPatches(prev => prev.filter(patch => {
            if (patch.id === patchId) {
                queueMicrotask(() => {
                    patch.transaction.commit();
                });
                return false;
            }
            return true;
        }));
    };

    const abortPatch = (patchId: string) => {
        React.startTransition(() => {
            setPatches(prev => prev.filter(patch => {
                if (patch.id === patchId) {
                    queueMicrotask(() => {
                        patch.transaction.abort();
                    });
                    return false;
                }
                return true;
            }));
        });
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
        return <div className="loading">Загрузка списка задач...</div>;
    }

    if (todoQuery.isError) {
        return <div className="error">Ошибка: {todoQuery.error?.toString()}</div>;
    }

    const data = todoQuery.data;
    if (!data) return null;

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'high':
                return '#ff4444';
            case 'medium':
                return '#ffaa00';
            case 'low':
                return '#44ff44';
            default:
                return '#666';
        }
    };

    return (
        <div className="patches-section">
            <div className="patches-main-content">
                <div className="todo-section">
                    <div className="todo-header">
                        <h3>📝 Список задач</h3>
                        <button onClick={handleAddItem} className="add-button">
                            ➕ Добавить задачу
                        </button>
                    </div>

                    <div className="todo-list">
                        {data.items.map(item => (
                            <div key={item.id} className={`todo-item ${item.completed ? 'completed' : ''}`}>
                                <input
                                    type="checkbox"
                                    checked={item.completed}
                                    onChange={() => handleToggleItem(item)}
                                />
                                <span className="todo-text">{item.text}</span>
                                <div className="priority-selector">
                                    <select
                                        value={item.priority}
                                        onChange={(e) => handleChangePriority(item, e.target.value as any)}
                                        style={{ color: getPriorityColor(item.priority) }}
                                    >
                                        <option value="low">Низкий</option>
                                        <option value="medium">Средний</option>
                                        <option value="high">Высокий</option>
                                    </select>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="patches-panel">
                    <h3>🔧 Панель патчей</h3>
                    <p>Каждое изменение создает патч, который можно подтвердить или отменить</p>

                    {patches.length === 0 && (
                        <div className="no-patches">Нет активных патчей</div>
                    )}

                    {patches.map(patch => (
                        <div key={patch.id} className={`patch-item ${patch.status}`}>
                            <div className="patch-name">{patch.name}</div>
                            <div className="patch-actions">
                                {patch.status === 'pending' && (
                                    <>
                                        <button
                                            onClick={() => commitPatch(patch.id)}
                                            className="commit-button"
                                        >
                                            ✅ Подтвердить
                                        </button>
                                        <button
                                            onClick={() => abortPatch(patch.id)}
                                            className="abort-button"
                                        >
                                            ❌ Отменить
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
