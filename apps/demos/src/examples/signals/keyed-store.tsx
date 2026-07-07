import React from "react";
import { Signal, unstable_KeyedSignal, useSignal } from "@fozy-labs/rx-toolkit";
import { Button, Card, CardBody, CardHeader, Chip } from "@heroui/react";

type Item = { id: string; name: string; qty: number };

// Реактивная keyed-коллекция: чтение как у Map, запись O(1),
// точечная реактивность по каждому ключу.
const cart = unstable_KeyedSignal.state<Item>();
cart.set("apple", { id: "apple", name: "Яблоки", qty: 1 });
cart.set("bread", { id: "bread", name: "Хлеб", qty: 2 });
cart.set("milk", { id: "milk", name: "Молоко", qty: 1 });

let nextId = 1;

// Список строк подписан на СТРУКТУРУ (values$): перерисовывается только
// при добавлении/удалении позиции, но не при смене количества у существующей.
const items$ = Signal.compute(() => cart.values$());

const inc = (id: string) => {
    const cur = cart.get(id);
    if (cur) cart.set(id, { ...cur, qty: cur.qty + 1 });
};

const addItem = () => {
    const id = `item-${nextId}`;
    cart.set(id, { id, name: `Товар ${nextId}`, qty: 1 });
    nextId += 1;
};

// React.memo + подписка на один ключ => на «+1» перерисовывается ровно одна строка.
const Row = React.memo(function Row({ id }: { id: string }) {
    // Каждая строка подписана РОВНО на свой ключ через Computed(get$),
    // поэтому обновление одного ключа не будит соседей.
    const item$ = React.useMemo(() => Signal.compute(() => cart.get$(id)), [id]);
    React.useEffect(() => () => item$.dispose(), [item$]);
    const item = useSignal(item$);

    const renders = React.useRef(0);
    renders.current += 1;

    if (!item) return null;

    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{item.name}</span>
            <div className="flex items-center gap-2">
                <span className="text-sm">
                    ×<span className="font-semibold text-secondary">{item.qty}</span>
                </span>
                <Button size="sm" variant="flat" onPress={() => inc(id)}>
                    +1
                </Button>
                <Chip size="sm" variant="flat" color="secondary">
                    рендеров: {renders.current}
                </Chip>
            </div>
        </div>
    );
});

export function Base() {
    // Подписка на структуру: массив строится заново только на add/remove.
    const items = useSignal(items$);

    return (
        <Card className="max-w-md pt-2">
            <CardHeader className="flex-col items-start gap-1">
                <span className="text-lg font-semibold">Корзина (unstable_KeyedSignal)</span>
                <span className="text-xs text-warning">экспериментально</span>
            </CardHeader>
            <CardBody className="space-y-3">
                <p className="text-xs text-gray-500">
                    Нажмите «+1» — счётчик рендеров растёт только у изменённой строки:
                    подписка идёт точечно, на её ключ.
                </p>

                <div className="space-y-2">
                    {items.map((it) => (
                        <Row key={it.id} id={it.id} />
                    ))}
                </div>

                <div className="flex justify-end">
                    <Button size="sm" variant="bordered" onPress={addItem}>
                        Добавить позицию
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
}
