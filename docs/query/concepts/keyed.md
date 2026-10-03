# Типизация аргументов (Keyed)

Все методы ресурсов и команд, принимающие аргументы, работают с типом `TArgsOrKeyed<TArgs>` — объединением сырых аргументов и обёрнутых в `TKeyed`.


## Типы

```ts
type TArgsOrKeyed<TArgs> = TArgs | TKeyed<TArgs>;

type TKeyed<T> = { value: T; key: string };
```

- **`TKeyed<T>`** — аргументы, обёрнутые с предвычисленным ключом кэша. Пара `{ value, key }`, где `key` — результат сериализации.
- **`TArgsOrKeyed<TArgs>`** — объединённый тип: сырые аргументы или `TKeyed`. Все публичные методы (`prefetch`, `invalidate`, `getEntry`, `getEntry$` и т.д.) принимают `TArgsOrKeyed<TArgs>`.


## Пайплайн аргументов

```
args (UI / хук)  →  keyedArgs (TKeyed<TArgs>)  →  key (string)
```

1. **args** — сырые аргументы, переданные пользователем.
2. **keyedArgs** — обёртка `{ value: args, key }`, где `key` вычислен через `serializeArgs`.
3. **key** — строковый ключ кэша, используемый в карте кэша.

Метод `toKeyed(args)` на ресурсе выполняет шаг 1 → 2.
Передача `TKeyed<TArgs>` напрямую позволяет избежать повторной сериализации.


## См. также

- [Ресурс — API][api-res] — методы ресурса, принимающие `TArgsOrKeyed<TArgs>`
- [Команда — API][api-cmd] — методы команды
- [Архитектура][architecture] — общая диаграмма компонентов

---

[api-res]: ../api/resource.md
[api-cmd]: ../api/command.md
[architecture]: architecture.md
