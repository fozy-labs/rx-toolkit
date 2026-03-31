import { createApi, ReactHooksPlugin } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider } from '@heroui/react';
import { fetches } from "../../utils/fetches";

const api = createApi({
    plugins: [new ReactHooksPlugin()],
});

const itemsResource = api.createResource({
    key: 'simple-items',
    queryFn: fetches.getItems,
});

export function Base() {
    const state = itemsResource.useResourceAgent();

    const handleResetAll = () => {
        api.resetAll();
        console.log('🔄 Все ресурсы сброшены!');
    };

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                📋 Простой ресурс 
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
                            {state.data.items.map((item: { id: number; name: string; description: string }) => (
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
                            onPress={handleResetAll}
                            fullWidth
                        >
                            🔄 Сбросить все ресурсы
                        </Button>

                        <p className="text-xs text-default-400 text-center">
                            Нажмите кнопку, чтобы вызвать api.resetAll() и сбросить все кеши
                        </p>
                    </>
                )}

            </CardBody>
        </Card>
    );
}
