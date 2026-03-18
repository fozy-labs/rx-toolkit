import { queryV2 } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider } from '@heroui/react';

interface Item {
    id: number;
    name: string;
    description: string;
}

interface ItemsData {
    items: Item[];
}

const api = queryV2.createApi({
    plugins: [new queryV2.ReactHooksPlugin()],
});

const itemsResource = api.createResource<void, ItemsData>({
    key: 'simple-items',
    queryFn: async (_args, { abortSignal }) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return {
            items: [
                { id: 1, name: 'Задача 1', description: 'Реализовать новую функцию' },
                { id: 2, name: 'Задача 2', description: 'Исправить баги в коде' },
                { id: 3, name: 'Задача 3', description: 'Написать документацию' },
                { id: 4, name: 'Задача 4', description: 'Провести код-ревью' },
                { id: 5, name: 'Задача 5', description: 'Оптимизировать производительность' },
            ],
        };
    },
});

export function Base() {
    const state = itemsResource.useResourceV2Agent(undefined);

    const handleResetAll = () => {
        api.resetAll();
        console.log('🔄 Все ресурсы v2 сброшены!');
    };

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                📋 Простой ресурс (Query v2)
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                {state.isInitialLoading && (
                    <div className="text-center py-8 text-lg">
                        ⏳ Загрузка списка...
                    </div>
                )}

                {state.isSuccess && state.data && (
                    <>
                        <div className="space-y-2">
                            {state.data.items.map((item: Item) => (
                                <div
                                    key={item.id}
                                    className="p-3 bg-default-100 rounded-lg"
                                >
                                    <p className="font-semibold">{item.name}</p>
                                    <p className="text-sm text-default-500">{item.description}</p>
                                </div>
                            ))}
                        </div>

                        {state.isRefreshing && (
                            <div className="text-center text-sm text-default-400">
                                🔄 Обновление данных...
                            </div>
                        )}

                        <Divider />

                        <Button
                            color="warning"
                            variant="flat"
                            onPress={handleResetAll}
                            fullWidth
                        >
                            🔄 Сбросить все ресурсы v2
                        </Button>

                        <p className="text-xs text-default-400 text-center">
                            Нажмите кнопку, чтобы вызвать api.resetAll() и сбросить все кеши v2
                        </p>
                    </>
                )}

                {state.isError && (
                    <div className="text-center py-8 text-danger">
                        ❌ Ошибка загрузки данных
                    </div>
                )}
            </CardBody>
        </Card>
    );
}
