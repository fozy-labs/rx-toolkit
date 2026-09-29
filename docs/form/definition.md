# Определение формы

Определение — дерево строителей `field` / `group` / `list` без состояния: одно на модуль, из него создаётся сколько угодно [инстансов](instance.md).

```typescript
import { unstable_FormSignal as FormSignal } from "@fozy-labs/rx-toolkit";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;
```

Строители проверяют опции сразу: неизвестная опция, неверное имя или неверный тип значения бросают [`FormConfigError`](validation.md#ошибки-конфигурации).

## Содержание

- [Поле](#поле)
- [Группа и корень](#группа-и-корень)
- [Список](#список)
- [Контекст инстанса](#контекст-инстанса)
- [Что видит колбэк](#что-видит-колбэк)
- [Порядок объявления](#порядок-объявления)
- [Где объявлять правило или запрос](#где-объявлять-правило-или-запрос)
- [Имена](#имена)


## Поле

```typescript
const email = f({
    schema: z.email().trim(),
    defaultValue: "",
    showErrors: "touched",
});
```

| Опция | Тип | По умолчанию |
|---|---|---|
| `schema` | Standard Schema, синхронная | обязательна |
| `defaultValue` | вход схемы | обязательна |
| `required` | `boolean` | `false` |
| `equals` | `(a: Input, b: Input) => boolean` | `Object.is` |
| `showErrors` | `"touched" \| "modified" \| "submitted" \| "always"`, см. [Видимость](validation.md#видимость-ошибок) | от родителя, у корня `"touched"` |
| `context` | `FormSignal.context<T>()`, см. [Контекст инстанса](#контекст-инстанса) | — |
| `queries` | запись запросов, см. [Запросы](validation.md#запросы) | — |
| `validate` | правило или запись правил, см. [Правила](validation.md#правила) | — |

### Схема

`value` поля — вход схемы (то, что редактируется), `parsed` — её результат. Типы берутся из `~standard.types` схемы: enum, литералы и вложенные объекты остаются узкими.

- **Coerce-схемы и схемы без `types` дают вход `unknown`.** У `z.coerce.number()` вход `unknown`, поэтому `defaultValue` и `set()` принимают что угодно. Нужен узкий вход — берите схему без coerce и преобразуйте значение в обработчике события.
- **Асинхронные схемы не поддерживаются.** Промис из `validate` схемы превращается в issue с источником `schema` и один `console.error`. Асинхронную проверку делают [запросом и правилом](validation.md#проверка-email).

### `required`

`required: true` только выставляет `isRequired` у узла — для звёздочки в UI. Issue он не создаёт и на `isValid$` не влияет: пустоту запрещает схема (`z.string().min(1)`). Условная обязательность — правило группы с `error(fields.x, …)`.

### `equals`

Сравнивает значения поля: дедуп в `set()`, `isDirty$` и фиксация базы после успешного сабмита. По умолчанию `Object.is`, поэтому для массивов и объектов `isDirty$` станет `true` после любого `set()` нового массива, даже равного базе. Передайте `shallowEqual` или `deepEqual`:

```typescript
import { shallowEqual } from "@fozy-labs/rx-toolkit";

const tags = f({ schema: z.array(z.string()), defaultValue: [], equals: shallowEqual });
```

Бросивший `equals` уходит в `console.error`, решает `Object.is`.


## Группа и корень

Группа объединяет детей; корень формы — тоже группа.

```typescript
const services = g({
    fields: { tariff, addedServices },
    validate: {
        freeTariff: ({ fields, error }) => {
            if (fields.tariff.value$() === "free" && fields.addedServices.value$().length)
                error(fields.addedServices, "Недоступно на бесплатном тарифе");
        },
    },
});

const RegistrationForm = g({
    name: "registration",
    fields: { name, email, services, phones },
    computed: {
        emailPlaceholder: ({ fields }) => `${fields.name.value$()}@company.com`,
    },
    validate: ({ fields, error }) => {
        if (!fields.name.value$() && !fields.email.value$()) error("Заполните имя или email");
    },
    submit: ({ parsed$ }) => registerCommand.bind(parsed$().value),
});
```

| Опция | Тип | По умолчанию |
|---|---|---|
| `fields` | `Record<string, определение>` | обязательна |
| `showErrors` | как у поля | от родителя, у корня `"touched"` |
| `context` | как у поля | — |
| `computed` | `Record<string, (ctx) => T>`; сигнал инстанса — `T \| undefined` | — |
| `queries` | как у поля | — |
| `validate` | как у поля | — |
| `disabled` | `{ [имя ребёнка]?: (ctx) => boolean }`, см. [Условные поля](validation.md#условные-поля-disabled) | — |
| `name` | только корень: ключ инстанса по умолчанию и имя корневого правила в источнике issue | `"root"` |
| `submit` | только корень: `(ctx) => command.bind(args) \| Promise`, см. [Сабмит](submit.md) | — |
| `mapSubmitError` | только корень: `(error) => IssueInput[]`, см. [Серверные ошибки](submit.md#серверные-ошибки) | опция плагина, иначе встроенный маппер |
| `pendingQueries` | только корень: `"wait" \| "ignore" \| "reject"`, см. [Ожидание запросов](submit.md#ожидание-запросов) | `"wait"` |

- **`computed`** — по `Signal.compute` на ключ, в инстансе `computed.<k>$`. До первого успешного вычисления значение `undefined`, после броска держится последнее удачное (см. [Броски](validation.md#броски-в-колбэках)).
- **Корневые опции** (`name`, `submit`, `mapSubmitError`, `pendingQueries`) делают группу корневой: вложить её в другую группу или в список нельзя — ошибка типов и `FormConfigError`.


## Список

```typescript
const phones = l({
    item: g({ fields: { kind, number } }),
    validate: ({ items$, error }) => {
        if (items$().length > 5) error("Не больше пяти");
    },
});
```

| Опция | Тип | По умолчанию |
|---|---|---|
| `item` | определение поля или группы без корневых опций | обязательна |
| `defaultValue` | массив входов `item` | `[]` |
| `showErrors`, `context`, `validate` | как у группы; `validate` видит `items$` вместо `fields` | — |

У каждой строки своя схема, поэтому ошибка строки ложится на узел строки; `validate` списка отвечает только за правила уровня списка (число строк, уникальность). Список списков не поддерживается: `item` — поле или группа.


## Контекст инстанса

Контекст — данные инстанса только для чтения: id сущности, параметр роута. Передаётся рядом с начальным состоянием, колбэки читают его через `context$`. Определение, которое читает контекст, объявляет требование:

```typescript
const ProfileForm = g({
    context: FormSignal.context<{ id: string }>(),
    fields: { name, email },
    submit: ({ parsed$, context$ }) => updateUser.bind({ id: context$().id, ...parsed$().value }),
});

const form = FormSignal.state(ProfileForm, { context: { id: "42" } }); // без context — ошибка типов
```

Требование поднимается к корню: группа без своего `context` требует пересечение контекстов детей, объявленный `context` должен их покрывать. Сменить контекст можно только у корня — `form.initialize({ context })`, см. [reset и initialize](instance.md#reset-и-initialize).


## Что видит колбэк

Колбэки видят только **входы**, никогда не **вердикты**. Вход — это `value$`, `parsed$`, `items$`, `get$` и вложенные `fields`, без действий. Вердикты — `isValid$`, `issues$`, `errors$`, `visible*$`, `state$`, алиасы `x$`, `isDisabled$`, `isPending$` — в контекстах не типизированы.

| Колбэк | `fields` | свои `value$` / `parsed$` | свои `computed` | свои `queries` | `context$` |
|---|---|---|---|---|---|
| `queries` поля | — | да | — | — | да |
| `validate` поля | — | да | — | да | да |
| `computed` группы | да | да | — | — | да |
| `queries` группы | да | да | да | — | да |
| `disabled` группы | да | — | — | — | да |
| `validate` группы | да | да | да | да | да |
| `validate` списка | `items$`, `get$` | да | — | — | да |
| `submit` | да | да, `parsed$` суженный | да | да | да |

- **Почему.** Правило, которое читает вердикт своего поддерева, замыкает цикл: правила предков входят в `issues$` потомков. `disabled`, читающий `value$` своей группы, — тоже цикл: значение группы зависит от `disabled`.
- **Цена.** `computed` не читает соседний `computed`, запрос не читает соседний запрос. Запрос поля не видит соседей по группе, поэтому запрос, зависящий от нескольких полей, объявляется на группе.
- **`queries` в контексте** — это `queries.<k>$` (состояние запроса) и `queries.<k>.isDebouncing$`, без `whenSettled`.
- **`parsed$` в `submit`** возвращает суженное `{ isParsed: true; value }`: сабмит вызывается только для разобранной формы, поэтому `parsed$().value` читается без проверки.

`error` / `warn` без узла адресуют issue узлу, на котором объявлено правило (на корне это ошибка формы). `error(node, …)` принимает узел из поддерева этого узла; узел вне поддерева — `FormConfigError`.


## Порядок объявления

Члены, которые видят друг друга, пишутся в порядке `computed` → `queries` → `validate` / `disabled` → `submit` → `mapSubmitError`: TypeScript выводит контекст каждого колбэка из членов, объявленных выше. Остальные опции (`fields`, `name`, `showErrors`, …) стоят где угодно.

Нарушение порядка не всегда даёт ошибку в самом колбэке. Член, объявленный слишком поздно, выпадает из типа, и ошибка появляется только при первом чтении — в колбэке ниже или у инстанса:

```typescript
const form = g({
    fields: { count },
    validate: ({ fields }) => void fields.count.value$(),
    queries: { cities: ({ fields }) => getCities.bind(fields.count.value$()) }, // объявлен после validate
});

FormSignal.state(form).queries.cities$; // ошибка типов: cities выпал из типа
```

Текст такой ошибки невнятный — при странной ошибке типов в `computed` / `queries` сначала проверьте порядок.


## Где объявлять правило или запрос

Правило живёт в ближайшей общей группе полей, которые оно читает, и читает `fields` относительно неё. У поля нет доступа к соседям, поэтому правило или запрос по двум полям объявляется на их группе.

**Строка списка не видит предков.** Строка не может объявить запрос, правило или `disabled`, зависящие от поля вне строки: например, цена по `(row.product, root.currency)`. Обходы:

- **Правило — на предке.** Правило группы, содержащей список, перебирает строки и адресует ошибку полю строки:

  ```typescript
  const Order = g({
      fields: { currency, rows },
      validate: {
          rowLimits: ({ fields, error }) => {
              const currency = fields.currency.value$();
              for (const row of fields.rows.items$()) {
                  if (currency === "USD" && row.fields.amount.value$() > 1000) error(row.fields.amount, "Лимит 1000 USD");
              }
          },
      },
  });
  ```

- **Запрос — на предке**, один на все строки: ключ собирает аргументы всех строк (`getPrices.bind({ currency, products })`), строка читает свою цену из общего результата.
- **Значение предка — полем строки.** Если значение нужно самой строке (например, для `disabled` её полей), обработчик события копирует его в поле строки через `set()`.


## Имена

Имена детей, правил, `computed` и `queries` не должны оканчиваться на `$` и содержать `.` или `/`: `$` занят алиасами инстанса, а `.` и `/` ломают строку источника issue и ключи devtools. Проверка есть и в типах, и в рантайме (`FormConfigError`). `name` корня и `key` инстанса не ограничены.
