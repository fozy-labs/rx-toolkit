import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Chip, Divider, Tab, Tabs } from '@heroui/react';
import React from 'react';
import { map, take, timer } from 'rxjs';

const api = createApi({
    plugins: [reactHooksPlugin()],
});

const BASE_PRICE: Record<string, number> = {
    BTC: 67_400,
    ETH: 3_520,
    SOL: 172,
};

// queryFn возвращает Observable: запись кэша становится «живой».
// Первая эмиссия завершает загрузку, каждая следующая обновляет данные
// на месте. take(15) завершает стрим — запись остаётся с последней ценой.
const priceFeed = api.createResource({
    key: 'price-feed',
    queryFn: (args: { symbol: string }) =>
        timer(600, 900).pipe(
            take(15),
            map((tick) => {
                const base = BASE_PRICE[args.symbol] ?? 100;
                const drift = Math.sin(tick / 2) * 0.01 + (Math.random() - 0.5) * 0.006;
                return {
                    symbol: args.symbol,
                    price: base * (1 + drift),
                    tick: tick + 1,
                };
            }),
        ),
});

const TOTAL_TICKS = 15;

export function Base() {
    const [symbol, setSymbol] = React.useState('BTC');
    const state = priceFeed.useResource({ symbol });

    const isLive = state.data != null && state.data.tick < TOTAL_TICKS;

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                📈 Живые котировки (стрим в queryFn)
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                <Tabs
                    selectedKey={symbol}
                    onSelectionChange={(key) => setSymbol(String(key))}
                    size="sm"
                >
                    {Object.keys(BASE_PRICE).map((s) => (
                        <Tab key={s} title={s} />
                    ))}
                </Tabs>

                {state.isInitialLoading && (
                    <div className="text-sm text-default-500">⏳ Подключение к стриму...</div>
                )}

                {state.data && (
                    <div className="p-4 bg-default-100 rounded-lg space-y-1">
                        <p className="text-3xl font-mono font-semibold">
                            ${state.data.price.toFixed(2)}
                        </p>
                        <p className="text-sm text-default-500">
                            {state.data.symbol} · тик {state.data.tick}/{TOTAL_TICKS}
                        </p>
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <Chip
                        size="sm"
                        variant="flat"
                        color={state.data ? (isLive ? 'success' : 'default') : 'warning'}
                    >
                        {state.data ? (isLive ? '● стрим открыт' : '○ стрим завершён') : '… ожидание'}
                    </Chip>
                    <Button
                        size="sm"
                        variant="flat"
                        onPress={() => priceFeed.refresh({ symbol })}
                    >
                        🔄 Переподключить
                    </Button>
                </div>

                <p className="text-xs text-default-400">
                    queryFn возвращает Observable: цена обновляется с каждой эмиссией
                    без перезапросов. Переключение символа — отдельная запись кэша со
                    своим стримом (SWR показывает старые данные, пока подключается новый).
                    «Переподключить» = refresh: отписка и новая подписка на стрим.
                </p>
            </CardBody>
        </Card>
    );
}
