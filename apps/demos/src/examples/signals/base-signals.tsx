import { Signal, useSignal } from "@fozy-labs/rx-toolkit";
import { Button, Card, CardBody } from "@heroui/react";

const counter$ = Signal.state(0);
const doubled$ = Signal.compute(() => counter$() * 2);

function increment() {
    counter$.set(counter$() + 1);
}

export function Base() {
    const count = useSignal(counter$);
    const doubled = useSignal(doubled$);

    return (
        <Card className="max-w-96">
            <CardBody className="space-y-1">
                <p>Count: {count}</p>
                <p>Doubled: {doubled}</p>
                <Button onPress={increment}>Increment</Button>
            </CardBody>
        </Card>
    );
}
