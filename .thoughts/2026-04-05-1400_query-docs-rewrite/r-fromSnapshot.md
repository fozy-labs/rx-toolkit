## Machine.fromSnapshot — факты из кода

1. **Существует** — статический метод в `Machine` ([Machine.ts](src/query/core/machines/Machine.ts#L18)). Принимает `TMachineState<TArgs, TData>`, возвращает `TMachineInstance<TArgs, TData>`.
2. **Воссоздаёт все 4 состояния**: switch по `state.status` → `MachinePending | MachineSuccess | MachineError | MachineRefreshing`. Для `success` **не** передаёт `lastError` (теряется при гидратации).
3. **Диаграмма**: стрелка идёт из `[*]` (внешний вход) в **любое** из 4 состояний — это не переход между состояниями, а точка входа наравне с `Machine.pending()`.
