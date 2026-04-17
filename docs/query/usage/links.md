# Связи (Links)

Связь (link) — декларативное соединение между [командой][command] и [ресурсом][resource]. После мутации связь автоматически синхронизирует кэш затронутых ресурсов: инвалидирует, обновляет оптимистично или подставляет данные из ответа сервера.

Связь определяется в колбэке `links` при создании **команды**. Функция `link` принимает конфигурацию с целевым ресурсом и стратегией обновления.


## Параметры конфигурации

| Параметр | Тип | Обязательный | Описание |
|----------|-----|-------------|----------|
| `resource` | `IResource<TResArgs, TResData>` | да | Целевой [ресурс][resource] |
| `forwardArgs` | `(commandArgs: TArgs) => TResArgs \| undefined` | да | Маппинг аргументов команды в ключ кэша ресурса. `undefined` — все записи |
| `invalidate` | `boolean` | нет | Инвалидировать запись после успеха команды |
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
trigger(args)
  │
  ├── optimisticUpdate  ← немедленно, до ответа сервера
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
- **invalidate** — помечает запись устаревшей после успеха; ресурс будет перезапрошен при следующем обращении.


## Комбинирование стратегий

### В одной связи

`optimisticUpdate` и `invalidate` можно объединить: UI обновляется мгновенно, а после успеха кэш инвалидируется и перезапрашивается с сервера. Это даёт и мгновенный отклик, и гарантию консистентности:

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
[broadcast]: ./broadcast.md
[dataflows]: ../concepts/dataflows.md
