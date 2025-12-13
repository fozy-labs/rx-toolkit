import { createResource, useResourceAgent, resetAllQueriesCache } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider } from '@heroui/react';
import { fetches } from '../../utils/fetches';

interface Item {
    id: number;
    name: string;
    description: string;
}

interface ItemsData {
    items: Item[];
}

export const getItems = createResource({
    queryFn: fetches.getItems,
    devtoolsName: 'simple-list/getItems',
});

export function Base() {
    const itemsQuery = useResourceAgent(getItems, undefined);

    const handleInvalidateAll = () => {
        resetAllQueriesCache();
        console.log('🔄 Все ресурсы сброшены!');
    };

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                📋 Простой список
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                {itemsQuery.isLoading && (
                    <div className="text-center py-8 text-lg">
                        ⏳ Загрузка списка...
                    </div>
                )}

                {itemsQuery.isSuccess && (
                    <>
                        <div className="space-y-2">
                            {(itemsQuery.data as ItemsData).items.map((item: Item) => (
                                <div
                                    key={item.id}
                                    className="p-3 bg-default-100 rounded-lg"
                                >
                                    <p className="font-semibold">{item.name}</p>
                                    <p className="text-sm text-default-500">{item.description}</p>
                                </div>
                            ))}
                        </div>

                        <Divider />

                        <Button
                            color="warning"
                            variant="flat"
                            onPress={handleInvalidateAll}
                            fullWidth
                        >
                            🔄 Сбросить все ресурсы
                        </Button>

                        <p className="text-xs text-default-400 text-center">
                            Нажмите кнопку, чтобы вызвать resetAllQueriesCache() и сбросить все кеши
                        </p>
                    </>
                )}

                {itemsQuery.isError && (
                    <div className="text-center py-8 text-danger">
                        ❌ Ошибка загрузки данных
                    </div>
                )}
            </CardBody>
        </Card>
    );
}

