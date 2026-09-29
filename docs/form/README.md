# Модуль Form

Модуль Form — формы поверх [сигналов][signals] и [query][query]: значения и черновики, валидация схемой и правилами, асинхронные проверки ресурсами, условные поля, списки строк и сабмит командой с раскладкой серверных ошибок по полям. Схема поля — любая синхронная [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType); ядро формы zod не импортирует.

> **Нестабильный API.** Точки входа экспортируются с префиксом `unstable_`:
> `unstable_FormSignal`, `unstable_formsPlugin`, `unstable_formsReactPlugin` — контракт может
> меняться без мажорной версии. В примерах импорт алиасится:
> `import { unstable_FormSignal as FormSignal }`.

## Содержание

- [Документы](#документы)
- [Быстрый старт](#быстрый-старт)
- [Описание и инстанс](#описание-и-инстанс)
- [Плагины и api.defineForm](#плагины-и-apidefineform)
- [Правила и ограничения](#правила-и-ограничения)


## Документы

| Документ | О чём |
|---|---|
| [Определение](definition.md) | `field` / `group` / `list` и их опции, контекст инстанса, что видит каждый колбэк, порядок объявления |
| [Инстанс и узлы](instance.md) | `FormSignal.state`, члены узлов, списки, `reset` / `initialize`, время жизни, devtools |
| [Валидация и запросы](validation.md) | issue, правила, видимость ошибок, `disabled`, запросы и debounce, броски, рецепты |
| [Сабмит](submit.md) | попытка, `pendingQueries`, состояние сабмита, серверные ошибки, повтор |
| [React](react.md) | `useForm`, синхронизация `init`, `Provide` / `useFormContext`, SSR |


## Быстрый старт

```tsx
import { z } from "zod";
import {
    createApi,
    unstable_FormSignal as FormSignal,
    unstable_formsReactPlugin,
    useSignal,
} from "@fozy-labs/rx-toolkit";

const f = FormSignal.field;

const api = createApi({ plugins: [unstable_formsReactPlugin()] });

// createUser: (args: { name: string; email: string }) => Promise<{ id: string }>
const register = api.createCommand({ queryFn: createUser });

const SignupForm = api.defineForm({
    name: "signup",
    fields: {
        name: f({ schema: z.string().trim().min(1, "Введите имя"), defaultValue: "" }),
        email: f({ schema: z.email("Некорректный email"), defaultValue: "" }),
    },
    submit: ({ parsed$ }) => register.bind(parsed$().value),
});

function Signup() {
    const form = SignupForm.useForm();
    const email = useSignal(form.fields.email$);
    const root = useSignal(form.state$);

    return (
        <form onSubmit={(e) => { e.preventDefault(); void form.submit(); }}>
            <input
                value={email.value}
                onChange={(e) => form.fields.email.set(e.target.value)}
                onBlur={form.fields.email.blur}
            />
            {email.visibleErrors[0] && <p>{email.visibleErrors[0].message}</p>}
            {/* поле name — так же */}
            <button disabled={!root.canSubmit}>Зарегистрироваться</button>
        </form>
    );
}
```

Ошибка email видна после `blur()` или после сабмита; `submit()` ждёт запросы, проверяет форму, отправляет `parsed$().value` командой и на успехе делает отправленное базой.


## Описание и инстанс

| | Определение — `field` / `group` / `list` | Инстанс — `FormSignal.state()` |
|---|---|---|
| Что это | дерево опций: схемы, правила, запросы, сабмит | дерево узлов с `$`-сигналами и действиями |
| Состояние | нет | значения, база, touched, серверные issue, сабмит |
| Создаётся | один раз на модуль | сколько угодно раз: `FormSignal.state(def, init)` или `Def.useForm(init)` |
| Время жизни | — | нет своего: граф значений, без `dispose()`, см. [Время жизни](instance.md#время-жизни) |

`$` помечает реактивное чтение: в определении `fields: { email }`, в инстансе `form.fields.email.value$()`. Подробнее — [Адресация и снимки](instance.md#адресация-и-снимки).


## Плагины и api.defineForm

Форма устроена как query: примитивы (`FormSignal.field` / `group` / `list` / `state`) работают без `api`, интеграция с `api` — плагином.

```typescript
import { createApi, unstable_FormSignal as FormSignal, unstable_formsPlugin } from "@fozy-labs/rx-toolkit";

const api = createApi({
    mapError: toApiError, // (error: unknown) => ApiError
    plugins: [unstable_formsPlugin({ mapSubmitError: (error: ApiError) => [{ message: error.message }] })],
});

const LoginForm = api.defineForm({ fields: { login, password }, submit: ({ parsed$ }) => signIn.bind(parsed$().value) });
const form = FormSignal.state(LoginForm);
```

`api.defineForm(options)` принимает опции корневой группы, как `FormSignal.group`, и добавляет:

- **типизацию `mapSubmitError` ошибкой `api`** — типом, который возвращает `mapError`. Тип ошибки в опции плагина указывается явно; если он не принимает ошибку `api`, вызвать `defineForm` нельзя (ошибка типов);
- **умолчания плагина**: опции плагина (`mapSubmitError`) действуют на формы этого `api`, если у формы нет своих. Глобальных умолчаний нет: форма из `FormSignal.group` опций плагина не видит;
- **промис из `submit` выполняется командой этого `api`**, см. [Хендлер submit](submit.md#хендлер-submit).

Для React подключайте [`unstable_formsReactPlugin()`](react.md) вместо `unstable_formsPlugin()`: он делает то же и добавляет React-члены. Классы плагинов — `unstable_FormsPlugin` и `unstable_FormsReactPlugin`.


## Правила и ограничения

Что надо знать до первой формы; подробности — по ссылкам.

- [`required` только помечает поле](definition.md#required): пустоту запрещает схема.
- [Coerce-схемы дают вход `unknown`](definition.md#схема); асинхронные схемы не поддерживаются.
- [Массивам и объектам нужен `equals`](definition.md#equals), иначе `isDirty$` врёт.
- [Порядок объявления](definition.md#порядок-объявления): `computed` → `queries` → `validate` / `disabled` → `submit`; нарушение может проявиться только при первом чтении.
- [Колбэки видят только входы](definition.md#что-видит-колбэк); гейт запроса — `parsed$().isParsed`, не `isValid$`.
- [Строка списка не видит предков](definition.md#где-объявлять-правило-или-запрос) — правило или запрос объявляются на предке.
- [Правило, читающее запрос, проверяет свежесть данных](validation.md#проверка-email).
- [Цикл через приведение типов или замыкание не всегда обнаруживается](validation.md#ошибки-конфигурации) — не читайте вердикты формы из её колбэков.
- [Запись узла запроса в devtools живёт до перезагрузки страницы](instance.md#devtools) (только dev).
- [SSR формы не поддерживается](react.md#ssr).

[signals]: ../signals/README.md
[query]: ../query/README.md
