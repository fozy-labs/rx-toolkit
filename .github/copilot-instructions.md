# rx-toolkit — AI Coding Guidelines

## Project

`@fozy-labs/rx-toolkit` — TypeScript-first reactive state management toolkit built on RxJS.

Three core modules:
- **signals/** — Reactive primitives: State, Computed, Effect, LocalState
- **query/** — Cache manager: Resource (read), Command (write), Operation
- **common/** — Shared utilities, React hooks, devtools, options

## Tech Stack

- TypeScript 5.9+ (strict mode, ESNext target, ESM)
- RxJS 7+ (peer dependency)
- React 19+ (peer dependency, optional)
- Zod 4+ (peer dependency, validation)
- Build: `tsc` + `tsc-alias` (`@/*` → `src/*`)

## Architecture

Exports: barrel `index.ts` per module; root `src/index.ts` re-exports all.

## Conventions

- Files: PascalCase for classes (`Signal.ts`), camelCase for functions (`createResource.ts`)
- Types: `XDefinition`, `XInstance`, `XAgentInstance`, `XCreateOptions`
- Signal protocol: `.get()`, `.peek()`, `.set()`, `.obs`
- Code: English. Documentation: Russian.

## Build

```bash
npm run build        # tsc → tsc-alias → dist/
npm run build:watch  # watch mode
npm run ts-check     # type-check only
```

## AI Workflow

Feature development follows staged delegation with human review gates:

```
/01-research → review → /02-design → review → /03-plan → review → /04-implement
```

Artifacts: `.thoughts/<YYYY-MM-DD>_<feature-name>/`. Diagrams: Mermaid.
