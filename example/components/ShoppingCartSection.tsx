import React from 'react';
import { createOperation, createResource, useOperationAgent, useResourceAgent } from '@fozy-labs/rx-toolkit';

const mockCart = {
    items: [
        { id: 1, name: 'Ноутбук', price: 50000, enabled: true },
        { id: 2, name: 'Мышь', price: 1500, enabled: false },
        { id: 3, name: 'Клавиатура', price: 3000, enabled: true },
        { id: 4, name: 'Монитор', price: 20000, enabled: false }
    ],
};

const fetchCart = async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { ...mockCart };
};

const fetchToggleItem = async (args: { id: number; enabled: boolean }) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return { id: args.id, enabled: args.enabled };
};

export const getCartResource = createResource({
    queryFn: fetchCart,
    cacheLifetime: 0,
    async onQueryStarted(args, { $queryFulfilled }) {
        console.log('onQueryStarted', { args });
        const result = await $queryFulfilled;
        console.log('$queryFulfilled:', { args, result });
    },
    async onCacheEntryAdded(args, { $cacheDataLoaded, $cacheEntryRemoved }) {
        console.log('onCacheEntryAdded', { args });
        await $cacheDataLoaded;
        console.log('$cacheDataLoaded', { args });
        await $cacheEntryRemoved;
        console.log('$cacheEntryRemoved', { args });
    }
});

export const toggleCartItem = createOperation({
    queryFn: fetchToggleItem,
    link(add) {
        add({
            resource: getCartResource,
            forwardArgs: () => undefined,
            optimisticUpdate: ({ draft, args }) => {
                const item = draft.items.find((i: any) => i.id === args.id);
                if (item) {
                    item.enabled = args.enabled;
                }
                return draft;
            }
        });
    }
});

export function ShoppingCartSection() {
    const cartQuery = useResourceAgent(getCartResource, undefined);
    const [toggleItem, toggleState] = useOperationAgent(toggleCartItem);

    const handleToggleItem = (id: number, enabled: boolean) => {
        toggleItem({ id, enabled });
    };

    React.useEffect(() => ()=> {
        console.log('ShoppingCartSection unmounted');
    }, []);

    const total = cartQuery.data?.items.reduce((sum: number, item: any) => item.enabled ? sum + item.price : sum, 0) || 0;

    return (
        <div className="demo-section">
            {cartQuery.isLoading && (
                <div className="loading">⏳ Загрузка корзины...</div>
            )}

            {cartQuery.isError && (
                <div className="error">
                    ❌ Ошибка загрузки корзины: {String(cartQuery.error)}
                </div>
            )}

            {cartQuery.isSuccess && cartQuery.data && (
                <div className="shopping-cart">
                    <h3>Товары в корзине:</h3>
                    {cartQuery.data.items.map((item: any) => (
                        <div key={item.id} className="cart-item">
                              <span>
                                {item.name} - {item.price}₽
                              </span>
                                <button
                                    onClick={() => handleToggleItem(item.id, !item.enabled)}
                                    style={{
                                        background: item.enabled ? '#d32f2f' : '#388e3c'
                                    }}
                                >
                                    {item.enabled ? 'Удалить' : 'Добавить'}
                                </button>
                        </div>
                    ))}

                    <div className="total">
                        Итого: {total}₽
                    </div>

                    {toggleState.isLoading && (
                        <div className="loading">
                            ⏳ Обновление корзины...
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
