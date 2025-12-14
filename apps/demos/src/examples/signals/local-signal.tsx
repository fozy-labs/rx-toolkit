import { LocalSignal, useSignal } from "@fozy-labs/rx-toolkit";
import { Button, Card, CardBody, Input } from "@heroui/react";

const name$ = LocalSignal.create({
    key: "userName",
    defaultValue: "",
});

const count$ = LocalSignal.create({
    key: "userCount",
    defaultValue: 0,
});

export function Base() {
    const name = useSignal(name$);
    const count = useSignal(count$);

    return (
        <Card className="max-w-96">
            <CardBody className="space-y-4">
                <div className="space-y-2">
                    <Input
                        label="Имя"
                        placeholder="Введите имя"
                        value={name}
                        onValueChange={(value) => name$.set(value)}
                    />
                    <p className="text-sm text-gray-600">
                        {name ? `Привет, ${name}!` : "Введите имя"}
                    </p>
                </div>

                <div className="space-y-2">
                    <p>Счётчик: {count}</p>
                    <div className="flex gap-2">
                        <Button
                            color="primary"
                            onPress={() => count$.set(count$.peek() + 1)}
                        >
                            +1
                        </Button>
                        <Button
                            color="default"
                            onPress={() => count$.set(0)}
                        >
                            Сбросить
                        </Button>
                    </div>
                </div>

                <p className="text-xs text-gray-500">
                    💾 Данные сохраняются в localStorage
                </p>
            </CardBody>
        </Card>
    );
}

