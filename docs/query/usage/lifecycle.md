# Хуки жизненного цикла (Lifecycle Hooks)

Хуки жизненного цикла позволяют реагировать на события кэш-записей.
Доступны как для [ресурсов][resource], так и для [команд][command].
Полный список параметров — в API-справочнике ([ресурс][api-resource],
    [команда][api-command]).


## onCacheEntryAdded

Вызывается **один раз** при создании кэш-записи для конкретных аргументов. 
Колбэк получает `args` и объект контекста `ctx`:

| Свойство ctx | Тип                                 | Описание                                                                                                |
|---|-------------------------------------|---------------------------------------------------------------------------------------------------------|
| `entry` | `CacheEntry` (ресурса или команды) | Текущая кэш-запись.                                                                                     |
| `$cacheDataLoaded` | `Promise<TData>`                    | Разрешается при первом успешном ответе. Отклоняется, если запись удалена до успешного получения данных. |
| `$cacheEntryRemoved` | `Promise<void>`                     | Разрешается при удалении записи из кэша.                                                                |


```typescript
const messagesResource = api.createResource({
    queryFn: (chatId: string) => fetch(`/api/chats/${chatId}/messages`).then(r => r.json()),
    onCacheEntryAdded: async (chatId, { $cacheDataLoaded, $cacheEntryRemoved }) => {
        console.log('Cache entry added for chatId:', chatId);

        await $cacheDataLoaded;
        
        console.log('Initial data loaded for chatId:', chatId);
        
        await $cacheEntryRemoved;
        
        console.log('Cache entry removed for chatId:', chatId);
    }
});
```

Хук работает аналогично и для [команд][command].


## onQueryStarted

Функция, которая вызывается при запуске каждого отдельного запроса. 
Позволяет выполнять код на протяжении всего жизненного цикла отдельного запроса.

Колбэк получает `args` и объект контекста `ctx`:

| Свойство ctx | Тип                                 | Описание                                                             |
|---|-------------------------------------|----------------------------------------------------------------------|
| `entry` | `CacheEntry` (ресурса или команды) | Текущая кэш-запись.                                                  |
| `$queryFulfilled` | `Promise<{ data: TData }>`          | Разрешается с данными при успехе. Отклоняется при ошибке или аборте. |

```typescript
const userResource = api.createResource({
  queryFn: (id: number) => fetch(`/api/users/${id}`).then(r => r.json()), 
  onQueryStarted: async (args, { $queryFulfilled }) => {
      console.log('Query started with args:', args);
      
      const { data } = await $queryFulfilled;
      
      console.log('Query succeeded with data:', data);
    },
});
```

Хук работает аналогично и для [команд][command].


## Обработка ошибок

Ошибки внутри колбэков **подавляются автоматически** — не выбрасываются наружу и не влияют на основной поток запроса. 
При необходимости (например, для предотвращения утечек памяти) оборачивайте `$queryFulfilled` и  `$cacheDataLoaded` в `try/catch`:

```typescript
onCacheEntryAdded: async (id, { $cacheDataLoaded, entry }) => {
    try {
        const connection = createUserConnection(id);
        const { data } = await $cacheDataLoaded;
    } catch {
        connection.close('unused');
        return;
    }

    connection.onUserUpdated((partialUser) => {
        const patch = entry.patch((draft) => {
            Object.assign(draft, partialUser);
        });

        path.commit();
    });

    await $cacheEntryRemoved;

    connection.close('disposed');
},
```


## См. также

- [Кэш][cache] — управление кэш-записями и их жизненным циклом
- [Ресурс][resource] — чтение данных и кэширование
- [Команда][command] — мутации и побочные эффекты
- [Потоки данных][dataflows] — диаграммы жизненного цикла запросов
- [API: ресурс][api-resource] — полная таблица параметров ресурса
- [API: команда][api-command] — полная таблица параметров команды


[cache]: ../concepts/cache.md
[resource]: ./resource.md
[command]: ./command.md
[dataflows]: ../concepts/dataflows.md
[api-resource]: ../api/resource.md
[api-command]: ../api/command.md
