import React from 'react';
import { z } from 'zod';
import { unstable_FormSignal as FormSignal, useSignal, type FieldNode } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardFooter, CardHeader, Chip, Divider, Input, Tab, Tabs } from '@heroui/react';

const f = FormSignal.field;
const g = FormSignal.group;

// The primitive API: no `api`, no plugin. A root without `submit` only validates.
const PayerForm = g({
    name: 'payer',
    fields: {
        kind: f({ schema: z.enum(['person', 'company']), defaultValue: 'person' }),
        fullName: f({ schema: z.string().trim().min(1, 'Введите ФИО'), defaultValue: '', required: true }),
        company: g({
            fields: {
                title: f({ schema: z.string().trim().min(1, 'Введите название'), defaultValue: '', required: true }),
                inn: f({ schema: z.string().regex(/^\d{10}$/, 'ИНН — 10 цифр'), defaultValue: '', required: true }),
            },
        }),
    },
    // A disabled child is left out of the value and of every aggregate; its draft stays.
    disabled: {
        company: ({ fields }) => fields.kind.value$() !== 'company',
    },
});

function TextField({ field, label }: { field: FieldNode<string>; label: string }) {
    const state = useSignal(field.state$);
    return (
        <Input
            label={label}
            value={state.value}
            onValueChange={field.set}
            onBlur={field.blur}
            isRequired={state.isRequired}
            isInvalid={state.visibleErrors.length > 0}
            errorMessage={state.visibleErrors[0]?.message}
        />
    );
}

export function Base() {
    const [form] = React.useState(() => FormSignal.state(PayerForm));
    const kind = useSignal(form.fields.kind$);
    const company = useSignal(form.fields.company$);
    const root = useSignal(form.state$);
    const value = useSignal(form.value$);

    return (
        <Card className="max-w-md">
            <CardHeader className="flex-row justify-between">
                <span className="font-bold text-lg">Плательщик</span>
                <Chip size="sm" variant="flat" color={root.isValid ? 'success' : 'default'}>
                    {root.isValid ? 'valid' : 'invalid'}
                </Chip>
            </CardHeader>
            <Divider />
            <CardBody className="gap-3">
                <Tabs
                    selectedKey={kind.value}
                    onSelectionChange={(key) => form.fields.kind.set(key === 'company' ? 'company' : 'person')}
                >
                    <Tab key="person" title="Физлицо" />
                    <Tab key="company" title="Юрлицо" />
                </Tabs>
                <TextField field={form.fields.fullName} label="ФИО" />
                {!company.isDisabled && (
                    <>
                        <TextField field={form.fields.company.fields.title} label="Название" />
                        <TextField field={form.fields.company.fields.inn} label="ИНН" />
                    </>
                )}
                <pre className="text-xs p-3 rounded-md bg-default-100 overflow-auto">
                    value$: {JSON.stringify(value, null, 2)}
                </pre>
            </CardBody>
            <Divider />
            <CardFooter className="justify-between gap-2">
                <span className="text-sm">
                    submit(): <b>{root.status}</b>
                </span>
                <div className="flex gap-2">
                    <Button size="sm" variant="flat" onPress={() => form.reset()}>
                        Сбросить
                    </Button>
                    <Button size="sm" color="primary" onPress={() => void form.submit()}>
                        Проверить
                    </Button>
                </div>
            </CardFooter>
        </Card>
    );
}
