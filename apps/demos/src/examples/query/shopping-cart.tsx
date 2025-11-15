import { createOperation, createResource, useOperationAgent, useResourceAgent } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Chip, Divider } from '@heroui/react';
import { fetches } from '../../utils/fetches';

export const getCart = createResource({
    queryFn: fetches.getCart,
    devtoolsName: 'shopping-cart/getCart'
});

export const toggleCartItem = createOperation({
    queryFn: fetches.toggleCartItem,
    link(add) {
        add({
            resource: getCart,
            forwardArgs: () => undefined,
            optimisticUpdate: ({ draft, args }) => {
                const item = draft.items.find((i: any) => i.id === args.id);
                if (item) item.enabled = args.enabled;
                return draft;
            }
        });
    },
    devtoolsName: 'shopping-cart/toggleCartItem'
});

export function Base() {
    const cartQuery = useResourceAgent(getCart, undefined);
    const [toggleItem, toggleState] = useOperationAgent(toggleCartItem);

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                🛒 Корзина покупок
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                {cartQuery.isLoading && (
                    <div className="text-center py-8 text-lg">
                        ⏳ Загрузка корзины...
                    </div>
                )}

                {cartQuery.isSuccess && (
                    <>
                        <div className="space-y-3">
                            {cartQuery.data!.items.map((item: any) => (
                                <div
                                    key={item.id}
                                    className="flex items-center justify-between p-3 bg-default-100 rounded-lg"
                                    style={{ opacity: item.enabled ? 1 : 0.5 }}
                                >
                                    <div>
                                        <p className="font-semibold">{item.name}</p>
                                        <p className="text-sm text-default-500">{item.price}₽</p>
                                    </div>
                                    <Button
                                        isIconOnly
                                        onPress={() => toggleItem({ id: item.id, enabled: !item.enabled })}
                                    >
                                        {item.enabled ? '🗑️' : '➕'}
                                    </Button>
                                </div>
                            ))}
                        </div>

                        <Divider />

                        <div className="flex justify-between items-center">
                            <span className="text-xl font-bold">Итого:</span>
                            <Chip size="lg" color="primary" variant="flat">
                                <span className="">{getTotal(cartQuery.data!.items)}₽</span>
                            </Chip>
                        </div>

                        {toggleState.isLoading && (
                            <div className="text-center text-sm text-default-500">
                                ⏳ Обновление корзины...
                            </div>
                        )}
                    </>
                )}
            </CardBody>
        </Card>
    );
}

function getTotal(items: any[]) {
    return items.reduce(
        (sum: number, item: any) => item.enabled ? sum + item.price : sum, 0
    );
}
