import { Signal, useSignal } from "@fozy-labs/rx-toolkit";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

class CounterStore {
    count$ = Signal.state(0, 'CounterStore/count$');

    doubled$ = Signal.compute(
        () => this.count$() * 2,
        'CounterStore/doubled$'
    );

    squared$ = Signal.compute(
        () => (this.doubled$() / 2) ** 2,
        'CounterStore/squared$'
    );

    increment = () => this.count$.update(
        (v) => v + 1,
        'CounterStore/increment'
    );
    decrement = () => this.count$.update(
        (v) => v - 1,
        'CounterStore/decrement'
    );
    reset = () => this.count$.set(0, 'CounterStore/reset');
}

const counterStore = new CounterStore();

export function Base() {
    const count = useSignal(counterStore.count$);
    const doubled = useSignal(counterStore.doubled$);
    const squared = useSignal(counterStore.squared$);

    return (
        <Card className="pt-4">
            <CardHeader className="justify-center text-lg font-semibold">Калькулятор</CardHeader>
            <CardBody className="space-y-4">
                <div className="text-4xl font-bold text-center text-primary">
                    {count}
                </div>

                <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Кол-во товаров: <span className="font-semibold text-secondary">{count}</span></li>
                    <li>Сумма (×2): <span className="font-semibold text-secondary">{doubled}</span></li>
                    <li>Бонус (²): <span className="font-semibold text-secondary">{squared}</span></li>
                </ul>

                <div className="flex gap-2 justify-center">
                    <Button color="success" onPress={counterStore.increment}>
                        Увеличить
                    </Button>
                    <Button color="danger" onPress={counterStore.decrement}>
                        Уменьшить
                    </Button>
                    <Button color="default" variant="bordered" onPress={counterStore.reset}>
                        Сбросить
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
}

