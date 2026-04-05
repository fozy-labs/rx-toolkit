# Target Design: Agent Flow

Based on user clarification, the TARGET design (docs = spec) differs from current code:

## Target behavior:
1. Agent calls `getEntry$(args)` with `doInitiate=false` (NOT true like in current code)
2. `getEntry$(args)` returns `null` if entry doesn't exist
3. Method is `agent.set(args)` (NOT `agent.start(args)`)
4. User sees `pending` state, `entry=null` when no entry exists
5. Entry and query are created only when `agent.set(args)` is called (via useImmediateEffect or similar)

## Key differences from current code:
- Current: `doInitiate=true` hardcoded in agent → `getOrCreate` always creates entry
- Target: `doInitiate=false` → agent gets null → separate mechanism creates entry
- Current: `agent.start(args)` via `React.useEffect`
- Target: `agent.set(args)` via `useImmediateEffect` (or similar)

## Implications for diagrams:
- Sequence diagram should show: getEntry$(args) → null → pending state → agent.set(args) → entry created → queryFn starts
