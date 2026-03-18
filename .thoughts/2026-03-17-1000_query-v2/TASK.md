# Task: Query v2 Module

Create a new query-v2 module based on the RFC (`docs/contributing/query-v2/README.md`).

## Requirements

- Full implementation — no simplifications, no shortcuts.
- Implement all public APIs described in the RFC: `createApi`, `api.createResource`, `ResourceV2`, agents, caching, patches, machines, snapshots, plugins.
- Both `serialize` and `compare` key strategies.
- `initialSnapshot` / `getSnapshot()` for SSR hydration/dehydration.
- Plugin system (including React hooks plugin).
- `onCacheEntryAdded`, `onQueryStarted` lifecycle hooks.
- `SKIP_TOKEN` support.
- Devtools integration with `beforeDevtoolsPush`.
- Comprehensive test suite covering all features.
- Strong TypeScript typing with automatic type inference.
- Follow the naming convention: `ResourceV2` prefix, `I`/`T` for interfaces/types.
- New code must NOT depend on legacy query v1 implementations.
- Implementation stage is expected to be very complex — plan accordingly with granular phases.

## RFC Reference

`docs/contributing/query-v2/README.md`
