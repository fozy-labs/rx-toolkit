import { useState } from "react";
import { Button, Card, CardBody, Input } from "@heroui/react";
import { LazySignal, useSignalValue, LazyComputed } from "@fozy-labs/rx-toolkit";

// Создаем lazy сигнал через статический метод create
const counter$ = LazySignal.create(0, "LazyCounter");
const doubled$ = LazyComputed.create(() => counter$() * 2, 'LazyDoubled');

function increment() {
    counter$.set(counter$.peek() + 1);
}

function decrement() {
    counter$.set(counter$.peek() - 1);
}

function reset() {
    counter$.set(0);
}

export function Base() {
    const count = useSignalValue(counter$);
    const doubled = useSignalValue(doubled$);

    return (
        <Card className="max-w-lg">
            <CardBody className="space-y-3">
                <h3 className="text-lg font-semibold">LazySignal Counter</h3>
                <div className="text-4xl font-bold text-center text-primary">
                    {count}
                </div>
                <div className="text-center text-secondary font-medium">
                    Удвоенное значение: {doubled}
                </div>
                <div className="flex gap-2 justify-center">
                    <Button color="success" onPress={increment}>
                        Увеличить
                    </Button>
                    <Button color="danger" onPress={decrement}>
                        Уменьшить
                    </Button>
                    <Button color="default" variant="bordered" onPress={reset}>
                        Сбросить
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
}

