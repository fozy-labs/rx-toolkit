import React from 'react';
import { createApi, reactHooksPlugin, CURRENT_SNAPSHOT_VERSION, type TApiSnapshot } from '@fozy-labs/rx-toolkit';
import { Card, CardBody, CardHeader, Divider } from '@heroui/react';

interface Product {
    id: number;
    name: string;
    price: number;
}

interface ProductList {
    items: Product[];
}

let fetchCount = 0;

// Симуляция snapshot с сервера (свежий, age < maxSnapshotDataAge)
const freshSnapshot: TApiSnapshot = {
    version: CURRENT_SNAPSHOT_VERSION,
    keyPrefix: 'snapshot-demo',
    timestamp: Date.now(), // Свежий snapshot — refetch не нужен
    resources: {
        'products': {
            entries: {
                'undefined': {
                    status: 'success',
                    args: undefined,
                    data: {
                        items: [
                            { id: 1, name: 'Ноутбук', price: 85000 },
                            { id: 2, name: 'Монитор', price: 32000 },
                            { id: 3, name: 'Клавиатура', price: 4500 },
                        ],
                    } satisfies ProductList,
                    updatedAt: Date.now(),
                },
            },
        },
    },
};

const api = createApi({
    keyPrefix: 'snapshot-demo',
    initialSnapshot: JSON.parse(JSON.stringify(freshSnapshot)),
    snapshotValidTime: 300_000, // 5 минут
    plugins: [reactHooksPlugin()],
});

const productsResource = api.createResource<void, ProductList>({
    key: 'products',
    queryFn: async () => {
        fetchCount++;
        await new Promise(resolve => setTimeout(resolve, 1500));
        return {
            items: [
                { id: 1, name: 'Ноутбук (обновлено)', price: 82000 },
                { id: 2, name: 'Монитор (обновлено)', price: 30000 },
                { id: 3, name: 'Клавиатура (обновлено)', price: 4200 },
                { id: 4, name: 'Мышь (новый товар)', price: 2500 },
            ],
        };
    },
});

export function Base() {
    const state = productsResource.useResource();
    const [currentFetchCount] = React.useState(() => fetchCount);

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                � Каталог товаров — мгновенная загрузка
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                {/* Счётчик запросов */}
                <div className="flex gap-2 flex-wrap">
                    <span className={`px-2 py-1 rounded text-xs font-mono ${currentFetchCount === 0 ? 'bg-success-100 text-success-700' : 'bg-warning-100 text-warning-700'}`}>
                        fetchCount при рендере: {currentFetchCount}
                        {currentFetchCount === 0 ? ' ✅ (без запроса!)' : ' (stale snapshot)'}
                    </span>
                    <span className="px-2 py-1 rounded text-xs font-mono bg-default-100 text-default-500">
                        status: {state.status}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-mono ${state.isRefreshing ? 'bg-warning-100 text-warning-700' : 'bg-default-100 text-default-400'}`}>
                        isRefreshing: {String(state.isRefreshing)}
                    </span>
                </div>

                <div className="p-3 bg-primary-50 border border-primary-200 rounded-lg">
                    <p className="text-sm text-primary-700">
                        💡 Каталог загружен из CDN-кэша — без задержки сети.
                        Свежий snapshot (age &lt; maxSnapshotDataAge) не вызывает refetch.
                    </p>
                </div>

                {state.data && (
                    <div className="space-y-2">
                        {state.data.items.map((item: Product) => (
                            <div
                                key={item.id}
                                className="p-3 bg-default-100 rounded-lg flex justify-between items-center"
                            >
                                <p className="font-semibold">{item.name}</p>
                                <p className="text-sm text-default-500">
                                    {item.price.toLocaleString('ru-RU')} ₽
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                {state.isRefreshing && (
                    <div className="text-center text-warning text-sm">
                        🔄 Обновление каталога с сервера...
                    </div>
                )}

                <Divider />
                <p className="text-xs text-default-400 text-center">
                    createApi(&#123; initialSnapshot, maxSnapshotDataAge &#125;) —
                    каталог предзагружен на сервере и доступен мгновенно. При устаревшем snapshot данные обновятся автоматически.
                </p>
            </CardBody>
        </Card>
    );
}
