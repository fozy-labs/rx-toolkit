import React from 'react';
import { assign, unstable_createMachine as createMachine, unstable_MachineSignal as MachineSignal, useSignal } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardFooter, CardHeader, Chip, cn, Divider } from '@heroui/react';

type LightContext = { cycles: number };
type LightEvent = { type: 'TIMER' } | { type: 'POWER_OUTAGE' } | { type: 'POWER_RESTORED' };

// The definition is pure data + named implementations: it can be pasted into
// Stately Studio as is (see `trafficLight.toXStateSource()`).
export const trafficLight = createMachine(
    {
        id: 'trafficLight',
        types: { context: {} as LightContext, events: {} as LightEvent },
        context: { cycles: 0 },
        initial: 'green',
        on: {
            POWER_OUTAGE: '.blinking',
        },
        states: {
            green: {
                // A named delay resolved through `implementations.delays`.
                after: { GREEN: 'yellow' },
                on: { TIMER: 'yellow' },
            },
            yellow: {
                after: { 1000: 'red' },
            },
            red: {
                after: { 3000: { target: 'green', actions: 'countCycle' } },
                on: { TIMER: { target: 'green', actions: 'countCycle' } },
            },
            blinking: {
                // Nested `after` timers are cancelled as soon as the state is left.
                initial: 'on',
                on: { POWER_RESTORED: 'red' },
                states: {
                    on: { after: { 500: 'off' } },
                    off: { after: { 500: 'on' } },
                },
            },
        },
    },
    {
        actions: {
            countCycle: assign({ cycles: ({ context }) => context.cycles + 1 }),
        },
        delays: {
            GREEN: 3000,
        },
    },
);

function Lamp({ color, isOn }: { color: 'red' | 'yellow' | 'green'; isOn: boolean }) {
    const palette = {
        red: 'bg-red-500 shadow-red-500/60',
        yellow: 'bg-yellow-400 shadow-yellow-400/60',
        green: 'bg-green-500 shadow-green-500/60',
    };

    return (
        <div
            className={cn(
                'size-12 rounded-full transition-all duration-300',
                isOn ? cn(palette[color], 'shadow-lg') : 'bg-gray-300 dark:bg-gray-700',
            )}
        />
    );
}

export function Base() {
    // The instance lives with the component: `start()` arms the timers,
    // `stop()` on unmount cancels them.
    const [light$] = React.useState(() => MachineSignal.state(trafficLight, { autoStart: false }));

    React.useEffect(() => {
        light$.start();
        return () => light$.stop();
    }, [light$]);

    const snapshot = useSignal(light$);
    const isBlinkingOn = light$.matches({ blinking: 'on' });

    return (
        <Card className="max-w-96">
            <CardHeader className="flex-row justify-between">
                <span className="font-bold text-lg">Светофор</span>
                <Chip size="sm" variant="flat">
                    {JSON.stringify(snapshot.value)}
                </Chip>
            </CardHeader>
            <Divider />
            <CardBody className="items-center gap-3">
                <div className="flex flex-col gap-2 p-3 rounded-2xl bg-gray-800">
                    <Lamp color="red" isOn={light$.matches('red') || isBlinkingOn} />
                    <Lamp color="yellow" isOn={light$.matches('yellow') || isBlinkingOn} />
                    <Lamp color="green" isOn={light$.matches('green')} />
                </div>
                <p className="text-sm text-gray-500">Полных циклов: {snapshot.context.cycles}</p>
            </CardBody>
            <Divider />
            <CardFooter className="justify-end gap-2">
                <Button
                    size="sm"
                    variant="flat"
                    isDisabled={!light$.can({ type: 'TIMER' })}
                    onPress={() => light$.send({ type: 'TIMER' })}
                >
                    Переключить
                </Button>
                {light$.matches('blinking') ? (
                    <Button size="sm" color="success" onPress={() => light$.send({ type: 'POWER_RESTORED' })}>
                        Восстановить питание
                    </Button>
                ) : (
                    <Button size="sm" color="danger" variant="flat" onPress={() => light$.send({ type: 'POWER_OUTAGE' })}>
                        Отключить питание
                    </Button>
                )}
            </CardFooter>
        </Card>
    );
}
