# Query (концепт)


---

Основные экспортируемые API

- createResource — создание ресурса (реактивного кэша, повторяемых запросов с поддержкой abort).
- createOperation — создание операции/мутации (одноразовый запрос, возвращает состояние выполнения).
  - createMutationApi — устаревший alias для обратной совместимости.
- createDevtools — helper для создания devtools интеграции (использует @reatom/devtools).
- SKIP — токен для пропуска автоматической инициации запроса в React hook.

---

Resource (createResource)

- Позволяет определить «ресурс» с функцией queryFn(args, tools) и опциональной функцией select для выбора/трансформ��ции результата.
- Для каждого набора аргументов поддерживается ReactiveCache c состоянием запроса (isLoading, isSuccess, isError, data и т.д.).
- Поведение initiate:
  - Если для тех же аргументов уже есть кэш — используется существующий ReactiveCache, его состояние обновляется.
  - При новой инициации старый AbortController (если был) прерывается, создаётся новый, передаётся в queryFn через abortSignal.
  - После выполнения queryFn результат опционально пропускается через select и записывается в кэш.
  - При ошибке вызывается SharedOptions.onError (если задан) и состояние обновляется.
- API ресурса предоставляет методы для получения/создания ReactiveCache по аргументам и создания агента (ResourceAgent).

Пример использования:

```ts
const userResource = createResource<{id: string}, User>({
  async queryFn(args, tools) {
    const res = await fetch(`/api/users/${args.id}`, { signal: tools.abortSignal });
    return await res.json();
  },
  select: (data) => ({ id: data.id, name: data.name }),
});
```

---

Operation (createOperation)

- Описывает одноразовую операцию/мутацию.
- Для каждой комбинации аргументов создаётся запись в QueriesCache, состояние отражает процесс выполнения (isLoading, isSuccess, isError и т.д.).
- initiate запускает queryFn(args) и обновляет состояние кэша по завершении или ошибке.
- Для обратной совместимости доступен mutate (deprecated) — возвращает промис, разрешающийся при завершении операции.

Пример:

```ts
const updateUser = createOperation<{id:string, data: Partial<User>}, User>({
  async queryFn(args) {
    const res = await fetch(`/api/users/${args.id}`, { method: 'PATCH', body: JSON.stringify(args.data) });
    return await res.json();
  }
});
```
---

Обновление

Мотивация использования ref вместо ручного управления (обновление, лок/анлок, оптимистичные обновление и откат):
- Ручное управление - сплошной и многословный бойлерплейт;
- В ref явно указывается что мы делаем со связанными ресурсами;

Пример:

```ts
const editUser = createOperation<{ id: string, data: Partial<User> }, User>({
    async queryFn(args) {
        const res = await fetch(`/api/users/${args.id}`, { method: 'POST', body: JSON.stringify(args.data) });
        return await res.json();
    },
    link(ref) {
        ref(userResource, {
            forwardArgs: (user) => user.id,
            lock: true,
            optimisticUpdate(draft, args) {
                Object.assign(draft, args.data);
            },
        })
        
        ref(usersResource, {
            forwardArgs: () => undefined,
            lock: true,
            optimisticUpdate(draft, args) {
                const item = draft.find(u => u.id === args.id);
                if (!item) return;
                Object.assign(item, args.data);
            }
        })
    }
});

const createUser = createOperation<{ id: string, data: Partial<User> }, User>({
    async queryFn(args) {
        const res = await fetch(`/api/users/${args.id}`, { method: 'POST', body: JSON.stringify(args.data) });
        return await res.json();
    },
    link(ref) {
        ref(userResource)({
            forwardArgs: (user) => user.id,
            create: (user) => user,
        });
        
        ref(usersResource)({
            forwardArgs: () => undefined,
            update(draft, user) {
                draft.push(user);
            },
        });
    }
});
```

---

DefaultOptions

- DefaultOptions.update позволяет задать/обновить опции: DEVTOOLS (devtools-инстанс) и onError (глобальный обработчик ошибок).
- Devtools интеграция включается передачей createDevtools() в DefaultOptions.update({ DEVTOOLS: ... }).

---

React hooks

- useResourceAgent(res, args)
  - res должен предоставлять createAgent().
  - Если args !== SKIP, hook при создании агента автоматически вызывает agent.initiate(args).
  - При изменении args: если текущее состояние уже инициализировано и shallowEqual(newArgs, state.args), повторная инициация не выполняется.
  - Возвращает текущее состояние ресурса (подписывается на agent.state$).

- useOperationAgent аналогично для операций (см. src/query/react).

---

SKIP токен

- Экспортируется как SKIP (Symbol). Используется в хукe useResourceAgent для пропуска автоматической инициации:

```ts
const state = useResourceAgent(usersResource, SKIP);
// позже можно вызвать agent.initiate(...) вручную
```

---
