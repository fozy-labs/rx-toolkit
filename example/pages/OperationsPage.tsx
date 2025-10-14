import React from 'react';
import { ShoppingCartSection } from '../components/ShoppingCartSection';
import { CodeBlock } from '../components/CodeBlock';

const operationsCode = `
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

    return (
        //...
    );
}`;

export function OperationsPage() {
  return (
    <div className="example-page">
      <div className="example-header">
        <h1>🛒 Операции и запросы</h1>
        <p>
          Демонстрация работы с createResource и createOperation для управления
          асинхронными операциями. Включает кеширование, обработку состояний загрузки,
          ошибок и оптимистичные обновления.
        </p>
      </div>

      <div className="example-content">
        <div>
          <ShoppingCartSection />
        </div>

        <div className="code-panel">
          <CodeBlock code={operationsCode} />
        </div>
      </div>
    </div>
  );
}
