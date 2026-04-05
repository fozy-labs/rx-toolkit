# Analysis: Sequence Diagram Fix — "Первый запрос"

## What's WRONG in the current diagram

1. **Arrow `Agent->>Res: getEntry$(args)` → response `Res-->>Agent: новый Entry (pending)`** — WRONG. Target: `getEntry$(args)` is called with `doInitiate=false`, returns `null` (not an Entry). Entry is NOT created at this point.

2. **Missing initial state delivery** — After getting `null`, Agent should deliver `{ status: pending, entry: null }` to UI BEFORE the entry exists. Current diagram skips this entirely.

3. **Missing `agent.set(args)` step** — Current diagram has no arrow for `agent.set(args)`. Target: `useImmediateEffect` calls `agent.set(args)`, which is the trigger that creates the entry.

4. **Missing `useImmediateEffect` trigger** — Current diagram jumps straight from `getEntry$` to `queryFn`. Target: there's an intermediate step where `useImmediateEffect` fires and calls `agent.set(args)`.

5. **Entry→Server arrow fires too early** — In current diagram `queryFn` fires right after `getEntry$`. Target: `queryFn` fires only after `agent.set(args)` → entry creation.

6. **SWR-fallback note position is misleading** — Note says "предыдущие данные → SWR-fallback" but this is a cache-miss scenario (first request), there are no previous data. Note should clarify it only applies on arg change, not first mount.

## CORRECTED message sequence for "Первый запрос"

1. UI → Agent: `useResource(args)` — hook creates Agent
2. [opt] args === SKIP → Agent → UI: `{ status: idle }`
3. Agent → Res: `getEntry$(args)` (doInitiate=false)
4. Res → Agent: `null` (нет записи в кеше)
5. Agent → UI: `{ status: pending, entry: null }` — первый рендер
6. [Note] `useImmediateEffect` срабатывает
7. UI → Agent: `agent.set(args)`
8. Agent → Res: создаёт запись (getOrCreate)
9. Res → Agent: новый Entry (pending)
10. Entry → Server: `queryFn(args, { abortSignal })`
11. [alt OK] Server → Entry: data → Entry: MachineSuccess → Agent → UI: `{ status: success, data }`
12. [alt error] Server → Entry: error → Entry: MachineError → Agent → UI: `{ status: error, error }`
