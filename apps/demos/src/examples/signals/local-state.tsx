import { LocalSignal, useSignal } from "@fozy-labs/rx-toolkit";
import { Button, Card, CardBody, CardFooter, CardHeader, Slider } from "@heroui/react";

const volume$ = LocalSignal.state({
    key: "user-volume",
    defaultValue: 1,
});

export function Base() {
    const count = useSignal(volume$);

    return (
        <div>
            <Card className="max-w-96">
                <CardHeader className="font-bold text-lg">
                    Настройки звука
                </CardHeader>
                <CardBody>
                    <Slider
                        label="Громкость"
                        minValue={0}
                        maxValue={2}
                        step={0.01}
                        showTooltip
                        formatOptions={{
                            style: 'percent',
                        }}
                        value={count}
                        onChange={value => volume$.set(Array.isArray(value) ? value[0] : value)}
                    />
                </CardBody>
                <CardFooter className="justify-end">
                    <Button
                        color="default"
                        onPress={() => volume$.clear()}
                    >
                        Сбросить
                    </Button>
                </CardFooter>
            </Card>

            <p className="text-xs text-gray-500">
                💾 Данные сохраняются в localStorage
            </p>
        </div>
    );
}

