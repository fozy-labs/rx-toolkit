# Research: Demos App Structure

**Status:** DONE  
**Date:** 2026-03-31

---

## 1. File Inventory

### `apps/demos/src/examples/`

```
examples/
  index.ts                  — re-exports: Signals, Query, QueryV2
  signals/
    index.ts
    base-signals.tsx
    counter-store.tsx
    local-state.tsx
  query/
    index.ts
    simple-list.tsx
    shopping-cart.tsx
    duplicator.tsx
    todo-patches.tsx
    user-profile.tsx
  query-v2/
    index.ts
    basic-query.tsx
    simple-resource.tsx
    optimistic-patches.tsx
    error-swr-states.tsx
    skip-token.tsx
    lifecycle-hooks.tsx
    snapshot-hydration.tsx
    ssr-snapshot.tsx
```

### `apps/demos/src/pages/`

```
pages/
  HomePage.mdx
  SignalsPage.mdx
  QueriesPage.mdx
  QueriesV2Page.mdx
```

### `apps/demos/src/app/`

```
app/
  App.tsx          — root layout + routing
  main.tsx         — React entry
  hero.ts          — HeroUI config(?)
  styles.css       — Tailwind entry
```

### `apps/demos/src/components/`

```
components/
  index.ts
  LiveExample.tsx
  QueryTabs.tsx
```

### `apps/demos/src/utils/`

```
utils/
  fetches.ts       — mock data fetchers with artificial delays
```

---

## 2. Routing Pattern

**Router:** react-router-dom v7, `<Routes>` inside `App.tsx`.

| Route          | Page component        |
| -------------- | --------------------- |
| `/`            | `HomePage.mdx`        |
| `/signals`     | `SignalsPage.mdx`     |
| `/queries`     | `QueriesPage.mdx`     |
| `/queries-v2`  | `QueriesV2Page.mdx`   |

Pages are **MDX** files that import `<LiveExample>` + `<QueryTabs>` + raw source via `?raw` imports. Each tab renders a live interactive example.

---

## 3. Example Registration Pattern

1. **Raw source file** — e.g. `examples/query-v2/basic-query.tsx`
2. **Barrel index** — `examples/query-v2/index.ts` imports each file with `?raw` suffix, exports as `examples` map
3. **Top-level barrel** — `examples/index.ts` re-exports namespaced: `QueryV2`
4. **MDX page** — imports `{ QueryV2 }` from examples, passes `QueryV2.examples.basicQuery` as `initialCode` to `<LiveExample>`

To add a new example:
- Create `.tsx` in the appropriate `examples/<module>/` folder
- Add `?raw` import + entry to the barrel's `examples` object
- Add `<Tab>` entry in the MDX page

---

## 4. Existing Query-V2 Examples

| Key                  | File                        | API Used                                              |
| -------------------- | --------------------------- | ----------------------------------------------------- |
| `simpleResource`     | `simple-resource.tsx`       | `createApi → createResourceV2 → useResourceV2Agent`   |
| `basicQuery`         | `basic-query.tsx`           | `createApi → createResourceV2 → useResourceV2Agent`   |
| `optimisticPatches`  | `optimistic-patches.tsx`    | optimistic updates via patches                        |
| `errorSwrStates`     | `error-swr-states.tsx`      | error/SWR state handling                              |
| `skipToken`          | `skip-token.tsx`            | conditional fetching with SKIP_TOKEN                  |
| `lifecycleHooks`     | `lifecycle-hooks.tsx`       | lifecycle hooks (onFetch, onSuccess, etc.)             |
| `snapshotHydration`  | `snapshot-hydration.tsx`    | snapshot hydration for SSR                            |
| `ssrSnapshot`        | `ssr-snapshot.tsx`          | SSR snapshot capture                                  |

**No Command v2 example exists yet.** All current v2 examples use `createResourceV2`. No `createCommandV2` reference found.

---

## 5. Import Convention

- **Package:** `@fozy-labs/rx-toolkit` — resolved via `"file:../.."` in `package.json`
- **Namespace:** `import { unstable_queryV2 } from '@fozy-labs/rx-toolkit'`
- **API access:** `unstable_queryV2.createApi(...)`, `unstable_queryV2.ReactHooksPlugin`, etc.
- **No path aliases** — uses `vite-tsconfig-paths` plugin but no custom aliases defined; relative imports for utils/components
- **UI kit:** `@heroui/react` for Card, Button, Tabs, etc.
- **Mock data:** `../../utils/fetches.ts` — simple async functions with `setTimeout` delays

---

## 6. Dependencies (Notable)

| Package                     | Version   |
| --------------------------- | --------- |
| `@fozy-labs/rx-toolkit`     | file:../.. |
| `react`                     | 19.2.0    |
| `react-router-dom`          | 7.9.6     |
| `@heroui/react`             | 2.8.5     |
| `react-live`                | 4.1.8     |
| `@mdx-js/rollup`            | 3.1.1     |
| `tailwindcss`               | 4.1.17    |
| `vite`                      | 5.4.21    |

---

## 7. Key Observations

- DevTools pre-configured in `App.tsx`: `DefaultOptions.update({ DEVTOOLS: reduxDevtools(...) })`
- Each example exports a `Base` component (convention)
- Examples are self-contained: create their own `api` + resource instances inside the file
- MDX pages provide narrative text around `<LiveExample>` tabs
- `react-live` is in deps — `LiveExample` likely renders editable code blocks
