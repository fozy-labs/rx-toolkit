# CLAUDE.md

## Project

`@fozy-labs/rx-toolkit` — a framework-agnostic reactive state-management library built on RxJS (peer deps: `rxjs`, `react`, `zod`; runtime dep: `immer`). ESM-only, TypeScript-first. Published to npm from `dist/`.

## Commands

```bash
pnpm run ts-check        # typecheck (tsc --noEmit)
pnpm run test            # typecheck tests (tsconfig.test.json) + vitest run
pnpm vitest run src/signals/signals/State.test.ts   # single test file
pnpm run test:watch      # vitest watch mode
pnpm run lint / lint:fix # ESLint over src/
pnpm run format / format:check   # Prettier over src/
pnpm run check:all       # ts-check + test + lint + format:check
pnpm run build           # rimraf dist && tsc && tsc-alias --resolve-full-paths
```

The demo app is separate (own deps and ESLint config): `pnpm run demos` from the root starts its dev server (`pnpm install` inside `apps/demos` first).

## Architecture

- Path alias: `@/*` → `src/*`.
- `src/index.ts` is the single public API entry.
- Each module has its own `index.ts` barrel.

Four modules:

- **`src/signals/`** — reactive primitives. 
  - `base/` holds the engine: `SourceSignal`, `DependencyTracker` (auto-tracking for computeds/effects), `Batcher` (update batching), `ComputeCache`, `SyncObservable` (sync bridge to RxJS).
  - `signals/` builds the public primitives on top: `State`, `Computed`, `Effect`, `LocalState`. 
  - Also `keyed/`, `operators/`, `proxy/`, `react/` (hooks like `useSignal`).
  - Signal protocol: `signal()` / `.peek()` / `.set(v)` / `.obs` (RxJS Observable).
- **`src/query/`** — cache manager (Resource = cached reads keyed by args, Command = mutations), built on signals.
  - `core/` contains the internals: 
    - `machine/` (state machine driving query lifecycle), 
    - `cache/` (cache entries, lifetimes, stale-while-revalidate),
    - `resource/` and `command/` (+ their Agents — per-args instances), 
    - `projection-resource/` (per-item projections over a batched request; `api.unstable_createProjectionResource`),
    - `patcher/` (optimistic updates via Immer patches with rebase on server response),
    - `snapshoter/` (SSR snapshots/hydration), 
    - `syncer/` (cross-tab sync via BroadcastChannel),
    - `api/` (Api container, hook composition), `errors/` (typed error classes).
  - `api/createApi.ts` is the entry point; 
  - plugins (e.g. `react/ReactHooksPlugin.ts` adding `useResource`/`useCommand`/`useSuspenseResource`) extend resources/commands via HKT-based types in `types/plugin-hkt.ts`.
- **`src/statechart/`** — statecharts on top of signals (nested/parallel/final/history states, `entry`/`exit`, `always`, `after`, guards, actions). Own runtime, no external deps.
  - `unstable_createMachine`, `unstable_MachineSignal`, `unstable_Statechart`.
  - Two layers: `createMachine()` → `MachineDefinition` (stateless config + implementations table) and `MachineSignal.state(definition)` (instance as a callable signal snapshot).
  - `core/` is the interpreter; `export/` — `toMermaid()` / `toXStateSource()`.
  - `__tests__/differential/` runs differential tests against `xstate` (devDependency only, not shipped).
- **`src/common/`** — shared utils, Redux DevTools integration, global default options, shared React helpers.
- `.tmp` - temporary files (gitignore)
- `benchmarks/` — comparative signals benchmarks vs alien-signals/preact/reatom (gitignored workspace, runs against built `dist`)

Docs for query concepts (`docs/query/concepts/`: machine → cache → agent) are the best deep-dive into `src/query/core/`; `docs/statechart/README.md` — into `src/statechart/`.

## Conventions

- Code and code comments in **English**; documentation in `docs/` in **Russian**.
- File naming: classes/types PascalCase (`Signal.ts`), factories/utilities camelCase (`createResource.ts`); type suffixes like `XDefinition`, `XInstance`.
- Tests live next to code (`MyModule.test.ts`); integration tests in `src/__tests__/integration/`. Vitest with `jsdom`.
- Conventional Commits, with adaptations: `chore(..)` for AI-environment setup.
- `docs/CHANGELOG.md` follows Keep a Changelog; update it alongside code changes (links in end of file).
- When changing `src/`, consider updating the matching docs in `docs/` and demos in `apps/demos/`.
