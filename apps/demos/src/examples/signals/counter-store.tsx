import { Signal, useSignal } from "@fozy-labs/rx-toolkit";
import { Button, Card, CardBody } from "@heroui/react";

class CounterStore {
    count$ = Signal.create(0);
    doubled$ = Signal.compute(() => this.count$() * 2);
    squared$ = Signal.compute(() => (this.doubled$() / 2) ** 2);

    increment = () => {
        console.log('INCREMENT');
        this.count$.set(this.count$.peek() + 1);
    };
    decrement = () => this.count$.set(this.count$.peek() - 1);
    reset = () => this.count$.set(0);
}

const counterStore = new CounterStore();

export function Base() {
    const count = useSignal(counterStore.count$);
    const doubled = useSignal(counterStore.doubled$);
    const squared = useSignal(counterStore.squared$);

    return (
        <Card className="pt-4">
            <CardBody className="space-y-4">
                <div className="text-4xl font-bold text-center text-primary">
                    {count}
                </div>

                <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Удвоенное: <span className="font-semibold text-secondary">{doubled}</span></li>
                    <li>В квадрате: <span className="font-semibold text-secondary">{squared}</span></li>
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

