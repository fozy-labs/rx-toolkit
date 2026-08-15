import { Signal, useSignal } from "@fozy-labs/rx-toolkit";
import { Button, Card, CardBody, CardHeader, Chip, Input } from "@heroui/react";
import { debounceTime, scan, startWith, Subject } from "rxjs";

// Stateful-пайплайн: scan хранит счётчик в живой подписке.
// keepAlive: 'forever' удерживает её от первого чтения до dispose() —
// состояние не сбрасывается, даже когда сигнал никто не наблюдает.
const clickBus$ = new Subject<void>();
const clickCount$ = Signal.from(
    clickBus$.pipe(
        scan((n) => n + 1, 0),
        startWith(0),
    ),
    { keepAlive: 'forever', key: 'SignalFrom/clickCount$' },
);

// Асинхронный пайплайн: до первой эмиссии debounceTime у сигнала нет значения,
// поэтому передаём default. Пока подписка «горячая», чтения идут из кеша.
const query$ = Signal.state('', 'SignalFrom/query$');
const debounced$ = Signal.from(
    query$.obs.pipe(debounceTime(300)),
    { default: '', key: 'SignalFrom/debounced$' },
);

export function Base() {
    const count = useSignal(clickCount$);
    const query = useSignal(query$);
    const debounced = useSignal(debounced$);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="font-bold text-lg">Счётчик кликов (scan)</CardHeader>
                <CardBody className="space-y-4">
                    <div className="text-4xl font-bold text-center text-primary">{count}</div>
                    <Button color="success" onPress={() => clickBus$.next()}>
                        Кликнуть
                    </Button>
                </CardBody>
            </Card>

            <Card>
                <CardHeader className="font-bold text-lg">Поиск с debounce (300 мс)</CardHeader>
                <CardBody className="space-y-2">
                    <Input
                        label="Запрос"
                        value={query}
                        onValueChange={(value) => query$.set(value)}
                    />
                    <p className="text-sm">
                        Мгновенно: <Chip size="sm">{query || '—'}</Chip>
                    </p>
                    <p className="text-sm">
                        С debounce: <Chip size="sm" color="secondary">{debounced || '—'}</Chip>
                    </p>
                </CardBody>
            </Card>
        </div>
    );
}
