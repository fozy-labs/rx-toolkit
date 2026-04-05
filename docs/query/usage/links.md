# Связи (Links)

Связь (link) — декларативное соединение между [командой][command] и [ресурсом][resource]. После мутации связь автоматически синхронизирует кеш затронутых ресурсов: инвалидирует, обновляет оптимистично или подставляет данные из ответа сервера.

Связь определяется на стороне **ресурса** методом `link()` и передаётся в массив `links` при создании **команды**. Базовый синтаксис и полный список опций описаны в [руководстве по командам][command-links].


## forwardArgs — адресация записей кеша

`forwardArgs` — единственное обязательное поле. Оно преобразует аргументы команды в ключ кеш-записи ресурса, определяя, **какие именно записи** затронет связь.

| Возвращаемое значение | Эффект |
|---|---|
| конкретные аргументы | Целевая запись с этим ключом |
| `undefined` | **Все** существующие записи ресурса |

Адресация конкретной записи:

```typescript
userResource.link({
  forwardArgs: (args) => args.userId,
  invalidate: true,
})
```

Адресация всех записей (например, при добавлении элемента в список):

```typescript
todosResource.link({
  forwardArgs: () => undefined,
  invalidate: true,
})
```

> Если `forwardArgs` возвращает аргументы, для которых записи в кеше ещё нет — связь не сработает (нечего обновлять/инвалидировать).


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
  │       └── invalidate ← после успешного ответа (помечает запись устаревшей)
  │
  └─ ERROR ── rollback   ← автоматический откат optimisticUpdate
```

- **optimisticUpdate** — применяется мгновенно, UI обновляется без ожидания. Использует Immer-патч; при ошибке команды откат происходит автоматически через систему [патчинга][patching].
- **update** — применяется после успеха, получает `result` из ответа сервера.
- **invalidate** — помечает запись устаревшей после успеха; ресурс будет перезапрошен при следующем обращении.


## Комбинирование стратегий

### В одной связи

`optimisticUpdate` и `invalidate` можно объединить: UI обновляется мгновенно, а после успеха кеш инвалидируется и перезапрашивается с сервера. Это даёт и мгновенный отклик, и гарантию консистентности:

```typescript
const updateTodoCommand = api.createCommand({
  queryFn: (args: { id: number; done: boolean }) =>
    fetch(`/api/todos/${args.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ done: args.done }),
    }).then(r => r.json()),
  links: [
    todosResource.link({
      forwardArgs: () => undefined,
      optimisticUpdate: (draft, args) => {
        const todo = draft.find((t: any) => t.id === args.id);
        if (todo) todo.done = args.done;
      },
      invalidate: true,
    }),
  ],
});
```

### Несколько связей на одну команду

Команда может затрагивать несколько ресурсов. Каждый ресурс получает собственную связь:

```typescript
const deleteProjectCommand = api.createCommand({
  queryFn: (args: { projectId: string }) =>
    fetch(`/api/projects/${args.projectId}`, { method: 'DELETE' }),
  links: [
    projectResource.link({
      forwardArgs: (args) => args.projectId,
      invalidate: true,
    }),
    projectListResource.link({
      forwardArgs: () => undefined,
      optimisticUpdate: (draft, args) => {
        const idx = draft.findIndex((p: any) => p.id === args.projectId);
        if (idx !== -1) draft.splice(idx, 1);
      },
      invalidate: true,
    }),
  ],
});
```


## Перспектива ресурса

Ресурс не знает о связях напрямую — метод `link()` лишь создаёт конфигурацию, привязанную к этому ресурсу. Вся логика выполнения принадлежит команде. Однако ресурс предоставляет инфраструктуру, которую связи используют:

- **Кеш-записи** — `forwardArgs` адресует записи через ту же систему ключей, что и `useResource(args)`.
- **Инвалидация** — эквивалент ручного вызова `resource.invalidate(args)`.
- **Патчинг** — `optimisticUpdate` и `update` применяют Immer-патчи через систему [патчинга][patching] записи.


## См. также

- [Команда][command] — создание команд, опции и React-хук `useCommand`
- [Ресурс][resource] — чтение данных и кеширование
- [Патчинг][patching] — механизм оптимистичных обновлений и отката

---

[command]: ./command.md
[command-links]: ./command.md#links
[resource]: ./resource.md
[patching]: ./patching.md
