import React from 'react';
import { and, assign, createMachine, MachineSignal, not, stateIn, useSignal } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardFooter, CardHeader, Chip, Divider, Input, Spinner } from '@heroui/react';

type FormContext = {
    email: string;
    password: string;
    attempts: number;
    error: string | null;
};

type FormEvent =
    | { type: 'CHANGE_EMAIL'; value: string }
    | { type: 'CHANGE_PASSWORD'; value: string }
    | { type: 'SUBMIT' }
    | { type: 'RETRY' };

export const signupForm = createMachine(
    {
        id: 'signupForm',
        types: { context: {} as FormContext, events: {} as FormEvent },
        context: { email: '', password: '', attempts: 0, error: null },
        initial: 'editing',
        states: {
            editing: {
                // Two orthogonal regions validate the fields independently.
                // `always` transitions re-evaluate the guards after every `assign`.
                type: 'parallel',
                states: {
                    email: {
                        initial: 'invalid',
                        states: {
                            invalid: { always: { target: 'valid', guard: 'isEmailValid' } },
                            valid: { always: { target: 'invalid', guard: not('isEmailValid') } },
                        },
                    },
                    password: {
                        initial: 'invalid',
                        states: {
                            invalid: { always: { target: 'valid', guard: 'isPasswordValid' } },
                            valid: { always: { target: 'invalid', guard: not('isPasswordValid') } },
                        },
                    },
                },
                on: {
                    CHANGE_EMAIL: { actions: assign({ email: ({ event }) => event.value }) },
                    CHANGE_PASSWORD: { actions: assign({ password: ({ event }) => event.value }) },
                    SUBMIT: {
                        target: 'submitting',
                        guard: and([
                            stateIn({ editing: { email: 'valid' } }),
                            stateIn({ editing: { password: 'valid' } }),
                        ]),
                    },
                },
            },
            submitting: {
                tags: 'busy',
                entry: assign({ attempts: ({ context }) => context.attempts + 1, error: null }),
                // The "server" answers after a delay; the first enabled transition wins.
                after: {
                    1500: [
                        { target: 'success', guard: 'isEmailFree' },
                        { target: 'failure', actions: assign({ error: 'Этот email уже занят' }) },
                    ],
                },
            },
            failure: {
                on: { RETRY: 'editing' },
            },
            success: {
                type: 'final',
            },
        },
    },
    {
        guards: {
            isEmailValid: ({ context }) => /^\S+@\S+\.\S+$/.test(context.email),
            isPasswordValid: ({ context }) => context.password.length >= 6,
            isEmailFree: ({ context }) => !context.email.startsWith('admin@'),
        },
    },
);

function ValidityChip({ label, isValid }: { label: string; isValid: boolean }) {
    return (
        <Chip size="sm" variant="flat" color={isValid ? 'success' : 'default'}>
            {label}: {isValid ? 'valid' : 'invalid'}
        </Chip>
    );
}

export function Base() {
    const [form$] = React.useState(() => MachineSignal.state(signupForm, { autoStart: false }));

    React.useEffect(() => {
        form$.start();
        return () => form$.stop();
    }, [form$]);

    const snapshot = useSignal(form$);
    const isBusy = snapshot.tags.includes('busy');

    if (snapshot.status === 'done') {
        return (
            <Card className="max-w-96">
                <CardBody className="gap-2">
                    <p className="font-bold text-lg">Аккаунт создан</p>
                    <p className="text-sm text-gray-500">
                        {snapshot.context.email}, попыток: {snapshot.context.attempts}
                    </p>
                </CardBody>
                <CardFooter className="justify-end">
                    {/* `start()` re-initializes a finished machine from its initial context. */}
                    <Button size="sm" variant="flat" onPress={() => form$.start()}>
                        Начать заново
                    </Button>
                </CardFooter>
            </Card>
        );
    }

    return (
        <Card className="max-w-96">
            <CardHeader className="flex-row justify-between">
                <span className="font-bold text-lg">Регистрация</span>
                <Chip size="sm" variant="flat">
                    {JSON.stringify(snapshot.value)}
                </Chip>
            </CardHeader>
            <Divider />
            <CardBody className="gap-3">
                <Input
                    label="Email"
                    placeholder="user@example.com (admin@… занят)"
                    value={snapshot.context.email}
                    isDisabled={!form$.can({ type: 'CHANGE_EMAIL', value: '' })}
                    onValueChange={(value) => form$.send({ type: 'CHANGE_EMAIL', value })}
                />
                <Input
                    label="Пароль"
                    type="password"
                    placeholder="не короче 6 символов"
                    value={snapshot.context.password}
                    isDisabled={!form$.can({ type: 'CHANGE_PASSWORD', value: '' })}
                    onValueChange={(value) => form$.send({ type: 'CHANGE_PASSWORD', value })}
                />
                <div className="flex gap-2">
                    <ValidityChip label="email" isValid={form$.matches({ editing: { email: 'valid' } })} />
                    <ValidityChip label="password" isValid={form$.matches({ editing: { password: 'valid' } })} />
                </div>
                {snapshot.context.error && <p className="text-sm text-danger">{snapshot.context.error}</p>}
            </CardBody>
            <Divider />
            <CardFooter className="justify-end gap-2">
                {isBusy && <Spinner size="sm" />}
                {form$.matches('failure') ? (
                    <Button size="sm" color="warning" onPress={() => form$.send({ type: 'RETRY' })}>
                        Исправить
                    </Button>
                ) : (
                    <Button
                        size="sm"
                        color="primary"
                        isDisabled={!form$.can({ type: 'SUBMIT' })}
                        onPress={() => form$.send({ type: 'SUBMIT' })}
                    >
                        Зарегистрироваться
                    </Button>
                )}
            </CardFooter>
        </Card>
    );
}
