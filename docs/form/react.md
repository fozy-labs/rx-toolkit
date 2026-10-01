# Формы в React

React-члены добавляет плагин `unstable_formsReactPlugin(options)`: `useForm` и `useFormContext` у определения, `Provide` у инстанса. Он подключается **вместо** [`unstable_formsPlugin()`](README.md#плагины-и-apidefineform) — с теми же опциями и тем же `api.defineForm`; вместе два плагина `createApi` не принимает. Ни один React-член не держит ресурсов.

```typescript
const api = createApi({ plugins: [reactHooksPlugin(), unstable_formsReactPlugin({ mapSubmitError })] });
```

## Содержание

- [useForm](#useform)
- [Синхронизация init](#синхронизация-init)
- [Чтение узлов](#чтение-узлов)
- [Provide и useFormContext](#provide-и-useformcontext)
- [Форма редактирования](#форма-редактирования)
- [SSR](#ssr)


## useForm

```typescript
Definition.useForm(init?, options?: { initializeOptions?: InitializeOptions }): FormInstance
```

- **Один инстанс на компонент**, `init` — как у [`FormSignal.state`](instance.md#создание) (`state`, `context`, `key`); обязателен, если определение требует контекст.
- **Определение и `key` читаются один раз.** Их смена — `console.warn`; для новой формы перемонтируйте компонент через React-`key`.
- **Размонтирование ничего не закрывает**: у инстанса нет своих ресурсов, сабмит в полёте доходит до конца.
- Компонент с `useForm` перерисовывается, когда сабмит начинается и заканчивается.
- В StrictMode инстанс один: повторный рендер переиспользует его, запрос уходит один.


## Синхронизация init

`useForm` синхронизирует `init` в инстанс на каждом рендере, сравнивая его по `deepEqual` с последним применённым. Поэтому новый литерал объекта на каждом рендере, двойной эффект StrictMode и повторный показ под `<Activity>` форму не переинициализируют. `File`, `Blob`, `URL` и другие встроенные объекты `deepEqual` сравнивает по ссылке: не создавайте их в рендере, иначе `init` меняется на каждом рендере.

- **`context`** применяется сразу, в том числе во время сабмита: `initialize({ context })`.
- **`state`** применяется через `initialize({ state }, initializeOptions)`, только когда сабмит не идёт. `state`, изменившийся во время сабмита, применяется после него — если не вернулся к значению на его старте. Так оптимистичный патч исходного ресурса и его откат не стирают серверные ошибки полей.
- **`state: undefined`** игнорируется: пока данные грузятся, форма остаётся на `defaultValue`.
- **`initializeOptions`** по умолчанию `{ keepDirtyValues: true }`: догрузка данных не затирает то, что пользователь уже ввёл.

Синхронизация не нужна — передайте стабильный `init`.


## Чтение узлов

Хуков полей нет: узлы читаются [`useSignal`](../usage/react/README.md#usesignal). Поле перерисовывается только от своего `state$`.

```tsx
const email = useSignal(form.fields.email$);                   // снимок поля
const phones = useSignal(form.fields.phones$);                 // { items, …meta }
const root = useSignal(form.state$);                           // { isValid, status, canSubmit, … }
const info = useSignal(form.fields.email.queries.emailInfo$);  // состояние запроса

<Input
    value={email.value}
    onValueChange={form.fields.email.set}
    onBlur={form.fields.email.blur}
    isInvalid={email.visibleErrors.length > 0}
    errorMessage={email.visibleErrors[0]?.message}
/>
```

Адаптер DOM-событий (`onChange={(e) => field.set(e.target.value)}`) — дело UI-кита приложения, не ядра. Подписка `useSignal` на узел держит его [запросы](validation.md#активность) горячими; скрытие под `<Activity>` их остужает, черновики остаются.


## Provide и useFormContext

`<form.Provide>` кладёт инстанс в контекст его определения; `Definition.useFormContext()` возвращает инстанс ближайшего `Provide` этого определения. Вне провайдера хук бросает ошибку, а не возвращает `undefined`.

```tsx
function Signup() {
    const form = SignupForm.useForm();
    return (
        <form.Provide>
            <EmailField />
        </form.Provide>
    );
}

function EmailField() {
    const form = SignupForm.useFormContext();
    const email = useSignal(form.fields.email$);
    // …
}
```

`Provide` создаётся при первом чтении, один на инстанс. Узел можно передать и пропом или через DI приложения.


## Форма редактирования

Данные приходят ресурсом; форма показывает `defaultValue`, пока они грузятся, и принимает их через синхронизацию `state`:

```tsx
const ProfileForm = api.defineForm({
    name: "profile",
    context: FormSignal.context<{ id: string }>(),
    fields: {
        name: f({ schema: z.string().trim().min(1, "Введите имя"), defaultValue: "" }),
        email: f({ schema: z.email("Некорректный email"), defaultValue: "" }),
    },
    submit: ({ parsed$, context$ }) => updateUser.bind({ id: context$().id, ...parsed$().value }),
});

function ProfileEditor({ id }: { id: string }) {
    const user = getUser.useResource(id);
    const form = ProfileForm.useForm({
        state: user.hasData ? { name: user.data.name, email: user.data.email } : undefined,
        context: { id },
        key: `profile/${id}`,
    });
    // …
}

<ProfileEditor key={id} id={id} />; // другой id — другой инстанс
```

Успешный сабмит делает отправленное [базой](submit.md#база-после-успеха); если команда инвалидирует `getUser`, пришедшие данные применятся с `keepDirtyValues` и не затрут правки, сделанные после отправки.


## SSR

Форма рендерится на сервере со значениями из `state`, переданного в `useForm`. Чтобы гидрация не разошлась, клиент передаёт тот же `state`.
