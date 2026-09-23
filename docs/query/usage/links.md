# Связи (Links)

Связь (link) — декларативное соединение между [командой][command] и [ресурсом][resource]. После мутации связь автоматически синхронизирует кэш затронутых ресурсов: инвалидирует, обновляет оптимистично или подставляет данные из ответа сервера.

Связь определяется в колбэке `links` при создании **команды**. Функция `link` принимает конфигурацию с целевым ресурсом и стратегией обновления.


## Параметры конфигурации

| Параметр | Тип | Обязательный | Описание |
|----------|-----|-------------|----------|
| `resource` | `IResource<TResArgs, TResData>` | да | Целевой [ресурс][resource] |
| `forwardArgs` | `(commandArgs: TArgs) => TResArgs \| undefined` | да | Маппинг аргументов команды в ключ кэша ресурса. `undefined` — все записи |
| `invalidate` | `boolean \| { inFlight?: 'cancel' \| 'trail' \| 'join' }` | нет | Инвалидировать запись после успеха команды. `true` ≡ `{}`. `inFlight` — что делать с запросом ресурса в полёте; без него — опция ресурса [`invalidateInFlight`][api-res-options] |
| `optimisticUpdate` | `(draft: TResData, commandArgs: TArgs) => void` | нет | Immer-рецепт, применяется немедленно |
| `update` | `(draft: TResData, commandArgs: TArgs, result: TData) => void` | нет | Immer-рецепт, применяется после успеха |


## forwardArgs — адресация записей кэша

`forwardArgs` — единственное обязательное поле. 
Оно преобразует аргументы команды в ключ кэш-записи ресурса, определяя, **какие именно записи** затронет связь.

Адресация конкретной записи:

```typescript
link({
  resource: userResource,
  forwardArgs: (args) => args.userId,
  invalidate: true,
})
```

> Если `forwardArgs` возвращает аргументы, для которых записи в кэше ещё нет — связь не сработает (нечего обновлять/инвалидировать).


## Тайминг выполнения

Стратегии выполняются в разные моменты жизненного цикла команды:

```
execute(args)
  │
  ├── optimisticUpdate  ← немедленно, до ответа сервера
  │      └─ THROW ── rollback всех патчей + reject; queryFn не вызывается
  │
  ├── queryFn(args)     ← сетевой запрос
  │
  ├─ OK ─┬── update     ← после успешного ответа (получает result)
  │      └── invalidate ← после успешного ответа (помечает запись устаревшей)
  │
  └─ ERROR ── rollback   ← автоматический откат optimisticUpdate
```

- **optimisticUpdate** — применяется мгновенно, UI обновляется без ожидания. Использует Immer-патч; при ошибке команды откат происходит автоматически через систему [патчинга][patching].
- **update** — применяется после успеха, получает `result` из ответа сервера.
- **invalidate** — помечает запись устаревшей после успеха: [удерживаемая][cache-holds] запись (смонтированный `useResource`) перезапрашивается сразу, остальные — при следующей подписке или `ensure` / `fetch`. См. [инвалидация тающей записи][cache-invalidation]. Запрос ресурса, ушедший до ответа команды, может привезти данные «до мутации»; что с ним делать, задаёт `inFlight` — см. [инвалидация в полёте][cache-inflight]:

```typescript
link({
  resource: userResource,
  forwardArgs: (args) => args.userId,
  invalidate: { inFlight: 'trail' }, // дать запросу в полёте доработать, перезапросить следом
})
```


## Комбинирование стратегий

### В одной связи

`optimisticUpdate` и `invalidate` можно объединить: UI обновляется мгновенно, а после успеха кэш инвалидируется и показанные данные перезапрашиваются с сервера. Это даёт и мгновенный отклик, и гарантию консистентности:

```typescript
const updateTodoCommand = api.createCommand({
  queryFn: fetchTodoUpdate,
  links: (link) => {
      link({
          resource: todosResource,
          forwardArgs: () => undefined,
          optimisticUpdate: (draft, args) => {
              const todo = draft.find((t: any) => t.id === args.id);
              if (todo) todo.done = args.done;
          },
          invalidate: true,
      });
  },
});
```


### Несколько связей на одну команду

Команда может затрагивать несколько ресурсов. Каждый ресурс получает собственную связь:

```typescript
const deleteProjectCommand = api.createCommand({
  queryFn: fetchProjectDelete,
  links: (link) => {
    link({
      resource: projectResource,
      forwardArgs: (args) => args.projectId,
      invalidate: true,
    });
    
    link({
      resource: projectListResource,
      forwardArgs: () => undefined,
      optimisticUpdate: (draft, args) => {
        const idx = draft.findIndex((p: any) => p.id === args.projectId);
        if (idx !== -1) draft.splice(idx, 1);
      },
      invalidate: true,
    });
  },
});
```


## См. также

- [Команда][command] — создание команд, опции и React-хук `useCommand`
- [Ресурс][resource] — чтение данных и кэширование
- [Патчинг][patching] — механизм оптимистичных обновлений и отката
- [Broadcast][broadcast] — кросс-табовая синхронизация состояния
- [Потоки данных][dataflows] — общая схема движения данных в Query



[command]: ./command.md
[resource]: ./resource.md
[patching]: ../concepts/patching.md
[cache-holds]: ../concepts/cache.md#кто-удерживает-запись
[cache-invalidation]: ../concepts/cache.md#инвалидация-тающей-записи
[cache-inflight]: ../concepts/cache.md#инвалидация-в-полёте
[api-res-options]: ../api/resource.md#опции
[broadcast]: ./broadcast.md
[dataflows]: ../concepts/dataflows.md
