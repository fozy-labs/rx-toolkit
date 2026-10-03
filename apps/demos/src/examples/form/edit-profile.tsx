import React from 'react';
import { z } from 'zod';
import { createApi, unstable_FormSignal as FormSignal, type FieldNode } from '@fozy-labs/rx-toolkit';
import { reactHooksPlugin, unstable_formsReactPlugin, useSignal } from '@fozy-labs/rx-toolkit/react';
import { Button, Card, CardBody, CardFooter, CardHeader, Chip, Divider, Input, Spinner, Tab, Tabs } from '@heroui/react';

interface Profile {
    name: string;
    email: string;
    about: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const serverProfiles: Record<string, Profile> = {
    '1': { name: 'Алексей Иванов', email: 'alexey@example.com', about: 'Разработчик' },
    '2': { name: 'Мария Петрова', email: 'maria@example.com', about: 'Дизайнер' },
};

const api = createApi({ plugins: [reactHooksPlugin(), unstable_formsReactPlugin()] });

const getProfile = api.createResource({
    key: 'form-edit-profile',
    queryFn: async (id: string) => {
        await delay(800);
        return { ...serverProfiles[id] };
    },
});

const saveProfile = api.createCommand({
    key: 'form-edit-save',
    queryFn: async ({ id, ...profile }: { id: string } & Profile) => {
        await delay(1000);
        if (profile.email.endsWith('@blocked.com')) {
            throw { issues: [{ path: ['email'], message: 'Этот домен заблокирован' }] };
        }
        serverProfiles[id] = profile;
        return profile;
    },
    // The refetched profile flows back into the form through `useForm`'s `state`.
    links: (link) => link({ resource: getProfile, forwardArgs: (args) => args.id, invalidate: true }),
});

const f = FormSignal.field;

const ProfileForm = api.defineForm({
    name: 'profile',
    context: FormSignal.context<{ id: string }>(),
    fields: {
        name: f({ schema: z.string().trim().min(1, 'Введите имя'), defaultValue: '' }),
        email: f({ schema: z.email('Некорректный email'), defaultValue: '' }),
        about: f({ schema: z.string().max(40, 'Не длиннее 40 символов'), defaultValue: '' }),
    },
    submit: ({ parsed$, context$ }) => saveProfile.bind({ id: context$().id, ...parsed$().value }),
});

function TextField({ field, label }: { field: FieldNode<string>; label: string }) {
    const state = useSignal(field.state$);
    return (
        <Input
            label={label}
            value={state.value}
            onValueChange={field.set}
            onBlur={field.blur}
            color={state.isDirty ? 'warning' : 'default'}
            isInvalid={state.visibleErrors.length > 0}
            errorMessage={state.visibleErrors[0]?.message}
        />
    );
}

function ProfileEditor({ id }: { id: string }) {
    const profile = getProfile.useResource(id);
    // `state` is synced on every render: applied once loaded, and again after a refetch,
    // keeping the fields the user has edited (keepDirtyValues).
    const form = ProfileForm.useForm({
        state: profile.hasData ? profile.data : undefined,
        context: { id },
        key: `profile/${id}`,
    });
    const root = useSignal(form.state$);

    const changeOnServer = () => {
        serverProfiles[id] = { ...serverProfiles[id], about: `${serverProfiles[id].about} ✓` };
        getProfile.invalidate(id);
    };

    return (
        <Card className="max-w-md">
            <CardHeader className="flex-row justify-between">
                <span className="font-bold text-lg">Профиль #{id}</span>
                <div className="flex gap-2 items-center">
                    {profile.isPending && <Spinner size="sm" />}
                    <Chip size="sm" variant="flat" color={root.isDirty ? 'warning' : 'default'}>
                        {root.isDirty ? 'есть правки' : 'как на сервере'}
                    </Chip>
                </div>
            </CardHeader>
            <Divider />
            <CardBody className="gap-3">
                <TextField field={form.fields.name} label="Имя" />
                <TextField field={form.fields.email} label="Email (…@blocked.com отклонит сервер)" />
                <TextField field={form.fields.about} label="О себе" />
            </CardBody>
            <Divider />
            <CardFooter className="justify-between gap-2">
                <Button size="sm" variant="light" onPress={changeOnServer}>
                    Изменить на сервере
                </Button>
                <div className="flex gap-2">
                    <Button size="sm" variant="flat" isDisabled={!root.isDirty} onPress={() => form.reset()}>
                        Отменить
                    </Button>
                    <Button
                        size="sm"
                        color="primary"
                        isDisabled={!root.canSubmit || !root.isDirty}
                        isLoading={root.isSubmitting}
                        onPress={() => void form.submit()}
                    >
                        Сохранить
                    </Button>
                </div>
            </CardFooter>
        </Card>
    );
}

export function Base() {
    const [id, setId] = React.useState('1');
    return (
        <div className="flex flex-col gap-3">
            <Tabs selectedKey={id} onSelectionChange={(key) => setId(String(key))}>
                <Tab key="1" title="Алексей" />
                <Tab key="2" title="Мария" />
            </Tabs>
            {/* Another id is another form: the React key remounts the editor. */}
            <ProfileEditor key={id} id={id} />
        </div>
    );
}
