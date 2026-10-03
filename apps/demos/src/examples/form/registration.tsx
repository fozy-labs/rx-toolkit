import React from 'react';
import { z } from 'zod';
import { createApi, unstable_FormSignal as FormSignal, type FieldNode } from '@fozy-labs/rx-toolkit';
import { unstable_formsReactPlugin, useSignal } from '@fozy-labs/rx-toolkit/react';
import { Button, Card, CardBody, CardFooter, CardHeader, Chip, Divider, Input, Spinner } from '@heroui/react';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The "server": taken emails, and a name it refuses with a field error.
const takenEmails = new Set(['admin@example.com', 'user@example.com']);

const api = createApi({ plugins: [unstable_formsReactPlugin()] });

const emailInfo = api.createResource({
    key: 'form-registration-email',
    queryFn: async (email: string) => {
        await delay(700);
        return { isFree: !takenEmails.has(email), isCorporate: email.endsWith('@corp.com') };
    },
});

const registerUser = api.createCommand({
    key: 'form-registration-submit',
    queryFn: async (args: { name: string; email: string }) => {
        await delay(1000);
        // The built-in mapper lays `issues` in the Standard Schema shape out by path.
        if (args.name.toLowerCase() === 'admin') {
            throw { issues: [{ path: ['name'], message: 'Имя admin зарезервировано' }] };
        }
        takenEmails.add(args.email);
        return { id: crypto.randomUUID().slice(0, 8) };
    },
});

const f = FormSignal.field;

const RegistrationForm = api.defineForm({
    name: 'registration',
    fields: {
        name: f({ schema: z.string().trim().min(2, 'Не короче двух символов'), defaultValue: '' }),
        email: f({
            schema: z.email('Некорректный email'),
            defaultValue: '',
            queries: {
                // The check starts once the email parses, 400 ms after the last keystroke.
                info: {
                    bind: ({ parsed$ }) => {
                        const parsed = parsed$();
                        return parsed.isParsed && emailInfo.bind(parsed.value);
                    },
                    debounce: 400,
                },
            },
            validate: ({ queries, error, warn }) => {
                // No verdict on data of other args: while debouncing, or while the
                // clutch shows the previous email's answer.
                if (queries.info.isDebouncing$()) return;
                const info = queries.info$();
                if (info.status === 'error') return warn('Не удалось проверить email');
                if (info.dataSource !== 'current') return;
                if (!info.data.isFree) error('Email уже занят');
                if (info.data.isCorporate) warn('Корпоративный адрес');
            },
        }),
    },
    // `submit()` waits for the email check (pendingQueries: "wait") before this runs.
    submit: ({ parsed$ }) => registerUser.bind(parsed$().value),
});

function TextField({ field, label, placeholder }: { field: FieldNode<string>; label: string; placeholder?: string }) {
    const state = useSignal(field.state$);
    return (
        <Input
            label={label}
            placeholder={placeholder}
            value={state.value}
            onValueChange={field.set}
            onBlur={field.blur}
            isInvalid={state.visibleErrors.length > 0}
            errorMessage={state.visibleErrors[0]?.message}
            description={state.visibleWarnings[0]?.message}
            endContent={state.isPending ? <Spinner size="sm" /> : null}
        />
    );
}

export function Base() {
    const form = RegistrationForm.useForm();
    const root = useSignal(form.state$);
    const submission = useSignal(form.submission$);

    if (root.status === 'success' && submission?.status === 'success') {
        return (
            <Card className="max-w-96">
                <CardBody className="gap-2">
                    <p className="font-bold text-lg">Аккаунт создан</p>
                    <p className="text-sm text-default-500">id: {submission.data.id}</p>
                </CardBody>
                <CardFooter className="justify-end">
                    {/* `initialize()` clears the form and resets the submit state. */}
                    <Button size="sm" variant="flat" onPress={() => form.initialize()}>
                        Ещё один
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
                    {root.status}
                </Chip>
            </CardHeader>
            <Divider />
            <CardBody className="gap-3">
                <TextField field={form.fields.name} label="Имя" placeholder="admin отклонит сервер" />
                <TextField
                    field={form.fields.email}
                    label="Email"
                    placeholder="admin@example.com занят, …@corp.com корпоративный"
                />
            </CardBody>
            <Divider />
            <CardFooter className="justify-between gap-2">
                <span className="text-xs text-default-400">попыток: {root.submitCount}</span>
                <Button
                    size="sm"
                    color="primary"
                    isDisabled={!root.canSubmit}
                    isLoading={root.isSubmitting}
                    onPress={() => void form.submit()}
                >
                    Зарегистрироваться
                </Button>
            </CardFooter>
        </Card>
    );
}
