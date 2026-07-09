# CLAUDE.md

## Project

`@fozy-labs/rx-toolkit` — a framework-agnostic reactive state-management library built on RxJS (peer deps: `rxjs`, `react`, `zod`; runtime dep: `immer`). ESM-only, TypeScript-first. Published to npm from `dist/`.

## Commands

```bash
npm run ts-check        # typecheck (tsc --noEmit)
npm run test            # typecheck tests (tsconfig.test.json) + vitest run
npx vitest run src/signals/signals/State.test.ts   # single test file
npm run test:watch      # vitest watch mode
npm run lint / lint:fix # ESLint over src/
npm run format / format:check   # Prettier over src/
npm run check:all       # ts-check + test + lint + format:check
npm run build           # rimraf dist && tsc && tsc-alias
```

The demo app is separate: `cd apps/demos && npm install && npm run dev` (own ESLint config).

## Architecture

- Path alias: `@/*` → `src/*`.
- `src/index.ts` is the single public API entry.
- Each module has its own `index.ts` barrel.

Three modules:

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
    - `patcher/` (optimistic updates via Immer patches with rebase on server response),
    - `snapshoter/` (SSR snapshots/hydration), 
    - `syncer/` (cross-tab sync via BroadcastChannel).
  - `api/createApi.ts` is the entry point; 
  - plugins (e.g. `react/ReactHooksPlugin.ts` adding `useResource`/`useCommand`/`useSuspenseResource`) extend resources/commands via HKT-based types in `types/plugin-hkt.ts`.
- **`src/common/`** — shared utils, Redux DevTools integration, global default options, shared React helpers.

Docs for query concepts (`docs/query/concepts/`: machine → cache → agent) are the best deep-dive into `src/query/core/`.

## Conventions

- Code and code comments in **English**; documentation in `docs/` in **Russian**.
- File naming: classes/types PascalCase (`Signal.ts`), factories/utilities camelCase (`createResource.ts`); type suffixes like `XDefinition`, `XInstance`.
- Tests live next to code (`MyModule.test.ts`); integration tests in `src/__tests__/integration/`. Vitest with `jsdom`.
- Conventional Commits, with adaptations: `chore(..)` for AI-environment setup.
- `docs/CHANGELOG.md` follows Keep a Changelog; update it alongside code changes (links in end of file).
- When changing `src/`, consider updating the matching docs in `docs/` and demos in `apps/demos/`.
