import React from 'react';
import { createMachine, DefaultOptions, log, MachineSignal, statelyInspector, useSignal } from '@fozy-labs/rx-toolkit';
import type { MachineContext, MachineStateSignal, StatelyInspector } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardFooter, CardHeader, Chip, Divider } from '@heroui/react';

type PlayerEvent =
    | { type: 'PLAY' }
    | { type: 'PAUSE' }
    | { type: 'STOP' }
    | { type: 'OPEN_SETTINGS' }
    | { type: 'CLOSE_SETTINGS' };

export const player = createMachine({
    id: 'player',
    types: { events: {} as PlayerEvent },
    initial: 'idle',
    states: {
        idle: {
            on: { PLAY: 'playback' },
        },
        playback: {
            initial: 'playing',
            on: { STOP: 'idle', OPEN_SETTINGS: 'settings' },
            states: {
                playing: { entry: log('playing'), on: { PAUSE: 'paused' } },
                paused: { entry: log('paused'), on: { PLAY: 'playing' } },
                // Remembers whether playback was playing or paused when settings were opened.
                hist: { type: 'history' },
            },
        },
        settings: {
            on: { CLOSE_SETTINGS: '#player.playback.hist' },
        },
    },
});

type PlayerSignal = MachineStateSignal<MachineContext, PlayerEvent>;

let inspector: StatelyInspector | null = null;

// Opens https://stately.ai/inspect in a popup (allow popups for this page).
// Every machine created afterwards is registered in the inspector.
function enableInspector() {
    inspector?.stop();
    inspector = statelyInspector();
    DefaultOptions.update({ MACHINE_DEVTOOLS: inspector });
}

function PlayerControls({ player$ }: { player$: PlayerSignal }) {
    const snapshot = useSignal(player$);
    const events: PlayerEvent['type'][] = ['PLAY', 'PAUSE', 'STOP', 'OPEN_SETTINGS', 'CLOSE_SETTINGS'];

    return (
        <>
            <Chip variant="flat">{JSON.stringify(snapshot.value)}</Chip>
            <div className="flex flex-wrap gap-2">
                {events.map((type) => (
                    <Button
                        key={type}
                        size="sm"
                        variant="flat"
                        isDisabled={!player$.can({ type })}
                        onPress={() => player$.send({ type })}
                    >
                        {type}
                    </Button>
                ))}
            </div>
        </>
    );
}

export function Base() {
    const [player$, setPlayer$] = React.useState<PlayerSignal | null>(null);
    const [showSource, setShowSource] = React.useState(false);

    React.useEffect(() => () => player$?.dispose(), [player$]);

    // A callable signal is a function: passed to a state setter directly, React
    // would treat it as an updater and store the snapshot it returns instead.
    const create = () => setPlayer$(() => MachineSignal.state(player));

    return (
        <Card className="max-w-xl">
            <CardHeader className="font-bold text-lg">Плеер</CardHeader>
            <Divider />
            <CardBody className="gap-3">
                {player$ ? (
                    <PlayerControls player$={player$} />
                ) : (
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onPress={create}>
                            Создать машину
                        </Button>
                        <Button
                            size="sm"
                            color="primary"
                            onPress={() => {
                                enableInspector();
                                create();
                            }}
                        >
                            Открыть Stately Inspector и создать
                        </Button>
                    </div>
                )}
                {showSource && (
                    <pre className="text-xs p-3 rounded-md bg-gray-100 dark:bg-gray-800 overflow-auto">
                        {player.toXStateSource()}
                    </pre>
                )}
            </CardBody>
            <Divider />
            <CardFooter className="justify-end gap-2">
                <Button size="sm" variant="light" onPress={() => setShowSource((v) => !v)}>
                    {showSource ? 'Скрыть код' : 'Код для Stately Studio'}
                </Button>
                {player$ && (
                    <Button size="sm" color="danger" variant="flat" onPress={() => setPlayer$(null)}>
                        Уничтожить
                    </Button>
                )}
            </CardFooter>
        </Card>
    );
}
