import { Signal, Computed, useSignal } from "@fozy-labs/rx-toolkit";
import { Button, Card, CardBody, CardHeader, Divider } from "@heroui/react";

class CounterStore {
    count$ = new Signal(0);
    doubled$ = new Computed(() => this.count$.value * 2);
    squared$ = new Computed(() => (this.doubled$.value / 2) ** 2);

    increment = () => this.count$.value++;
    decrement = () => this.count$.value--;
    reset = () => this.count$.value = 0;
}

const counterStore = new CounterStore();

export function Base() {
    const count = useSignal(counterStore.count$);
    const doubled = useSignal(counterStore.doubled$);
    const squared = useSignal(counterStore.squared$);

    return (
        <Card className="max-w-2xl">
            <CardHeader>
                <h3 className="text-xl font-bold">📊 Счетчик с вычисляемыми значениями</h3>
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                <div className="text-4xl font-bold text-center text-primary">
                    {count}
                </div>

                <div className="space-y-2">
                    <p className="text-sm text-default-500">
                        <strong>Вычисляемые значения:</strong>
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                        <li>Удвоенное: <span className="font-semibold text-secondary">{doubled}</span></li>
                        <li>В квадрате: <span className="font-semibold text-secondary">{squared}</span></li>
                    </ul>
                </div>

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

