# CLAUDE.md

## Project

`@fozy-labs/rx-toolkit` — a framework-agnostic reactive state-management library: signals, a query cache, statecharts and forms.

- TypeScript-first, ESM-only; published to npm from `dist/`.
- Peer deps: `rxjs`, `react`. Runtime dep: `immer`.
- Schemas: any Standard Schema; `zod` and `xstate` are devDependencies for tests only, not shipped.

## Commands

```bash
pnpm run ts-check                # typecheck (tsc --noEmit)
pnpm run test                    # typecheck tests (tsconfig.test.json) + vitest run
pnpm vitest run src/signals/signals/State.test.ts   # single test file
pnpm run test:watch              # vitest watch mode
pnpm run lint / lint:fix         # ESLint over src/
pnpm run format / format:check   # Prettier over src/
pnpm run check:all               # ts-check + test + lint + format:check
pnpm run build                   # rimraf dist && tsc && tsc-alias --resolve-full-paths
pnpm run demos                   # demo app dev server (run `pnpm install` in apps/demos first)
```

## Map

- `src/index.ts` — the single public API entry.
- `src/signals/` — reactive primitives: `signal()` / `.peek()` / `.set(v)` / `.obs`. RxJS only at the edges: `.obs` and `Signal.from`. Deep-dive: [docs/signals](docs/signals/README.md).
  - `base/core.ts` — the push-pull engine: a write marks dependents, a read brings a node up to date. Internal, not exported.
  - `base/` — the rest of the engine: `ReceiverNode` — a node fed by an RxJS upstream; `LiveSourceNode` — a per-part source for keyed and proxy signals; `Batcher`, `SourceSignal`, `Devtools`, `SignalCycleError` — public.
  - `signals/` — public primitives: `Signal` facade (`state` / `compute` / `effect` / `from`), `State`, `Computed`, `Effect`, `FromSignal`, `LocalState`, `LocalSignal`.
  - `keyed/` — `unstable_KeyedSignal`.
  - `proxy/` — `unstable_ProxySignal`.
  - `react/` — `useSignal`.
- `src/query/` — cache manager: Resource — cached reads keyed by args, Command — mutations. Entry point — `api/createApi.ts`. Deep-dive: [docs/query/concepts](docs/query/concepts/architecture.md).
  - `core/` — internals, not exported.
  - `core/resource/`, `core/command/` — Resource and Command with their Clutches — per-args instances.
  - `core/cache/` — `QueryCacheEntry` — flat entry state, stale-while-revalidate, invalidation; `Retainer` — entry lifetime and `hold()`.
  - `core/machine/` — state transitions behind the entry state.
  - `core/projection-resource/` — per-item projections over a batched request (`api.unstable_createProjectionResource`).
  - `core/patcher/` — optimistic updates via Immer patches, rebased on the server response.
  - `core/snapshotter/` — SSR snapshots and hydration.
  - `core/syncer/` — cross-tab sync via BroadcastChannel.
  - `core/api/` — Api container, hook composition.
  - `core/errors/` — typed error classes.
  - `react/` — `ReactHooksPlugin`: `useResource`, `useSuspenseResource`, `useInfiniteResource`, `useCommand`.
  - `types/` — public types; `plugin-hkt.ts` — HKT types through which plugins extend resources, commands and `api`.
  - `lib/` — public helpers: `stableStringify`, `toKeyed`, `broadcastSyncDriver`, `wrapTrigger`, `abortReason`.
- `src/statechart/` — statecharts on signals: nested / parallel / final / history states, `entry` / `exit`, `always`, `after`, guards, actions. Own runtime, no external deps. Deep-dive: [docs/statechart](docs/statechart/README.md).
  - Two layers: `unstable_createMachine()` → `MachineDefinition` — stateless config plus implementations table; `unstable_MachineSignal.state(definition)` — instance as a callable signal snapshot. Also `unstable_Statechart`.
  - `core/` — the interpreter.
  - `export/` — `toMermaid()`, `toXStateSource()`.
  - `__tests__/differential/` — differential tests against `xstate`.
- `src/form/` — forms on signals and query; a field schema is any sync Standard Schema. Deep-dive: [docs/form](docs/form/README.md).
  - `FormSignal.ts` — `unstable_FormSignal`: `field` / `group` / `list` definitions, `state()` creates an instance.
  - `formsPlugin.ts`, `react/` — `unstable_formsPlugin` (`api.defineForm`), `unstable_formsReactPlugin` (`useForm`).
  - `core/definition/` — builders.
  - `core/nodes/` — field / group / list runtime, query nodes.
  - `core/runtime/`, `core/validation/`, `core/submit/` — actions and values, validation, submit.
- `src/common/` — shared utils, devtools (Redux DevTools, Stately inspector), global default options, React helpers.
- `src/__tests__/` — integration tests and test helpers.
- `apps/demos/` — demo app with its own deps and ESLint config.
- `benchmarks/` — signals benchmarks vs alien-signals / preact / reatom, run against built `dist`. Gitignored.
- `.tmp/` — temporary files. Gitignored.

## Code style

- Path alias: `@/*` → `src/*`.
- Each module has its own `index.ts` barrel.
- File naming: classes/types PascalCase (`Signal.ts`), factories/utilities camelCase (`createResource.ts`); type suffixes like `XDefinition`, `XInstance`.
- Tests live next to code (`MyModule.test.ts`); integration tests in `src/__tests__/integration/`. Vitest with `jsdom`.
- Code and code comments in **English**.

## Workflow

- Documentation in `docs/` in **Russian**.
- Conventional Commits, with adaptations: `chore(..)` for AI-environment setup.
- `docs/CHANGELOG.md` follows Keep a Changelog; update it alongside code changes (links in end of file).
- When changing `src/`, consider updating the matching docs in `docs/` and demos in `apps/demos/`.
