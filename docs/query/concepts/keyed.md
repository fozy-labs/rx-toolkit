# Типизация аргументов (Keyed)

Все методы ресурсов и команд, принимающие аргументы, работают с типом `Args<TArgs>` — объединением сырых аргументов и обёрнутых в `Keyed`.


## Типы

```ts
type Args<TArgs> = TArgs | Keyed<TArgs>;

type Keyed<T> = { value: T; key: string };
```

- **`Keyed<T>`** — аргументы, обёрнутые с предвычисленным ключом кэша. Пара `{ value, key }`, где `key` — результат сериализации.
- **`Args<TArgs>`** — объединённый тип: сырые аргументы или `Keyed`. Все публичные методы (`trigger`, `refresh`, `getEntry`, `getEntry$`) принимают `Args<TArgs>`.


## Пайплайн аргументов

```
args (UI / хук)  →  keyedArgs (Keyed<TArgs>)  →  key (string)
```

1. **args** — сырые аргументы, переданные пользователем.
2. **keyedArgs** — обёртка `{ value: args, key }`, где `key` вычислен через `serializeArgs`.
3. **key** — строковый ключ кэша, используемый в `CacheMap`.

Метод `toKeyed(args)` на ресурсе выполняет шаг 1 → 2.
Передача `Keyed<TArgs>` напрямую позволяет избежать повторной сериализации.


## См. также

- [Ресурс — API][api-res] — методы ресурса, принимающие `Args<TArgs>`
- [Команда — API][api-cmd] — методы команды
- [Архитектура][architecture] — общая диаграмма компонентов

---

[api-res]: ../api/resource.md
[api-cmd]: ../api/command.md
[architecture]: architecture.md
