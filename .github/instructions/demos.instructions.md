---
name: "demos"
description: "Instructions for working with the rx-toolkit interactive demos app"
applyTo: "apps/demos/**"
---

# Demos App Guidelines

## Project Structure Overview

**Tech stack**: React 19, Vite, MDX, TailwindCSS v4, HeroUI, react-live, react-router-dom, prism-react-renderer.

**Key directories** (all under `apps/demos/src/`):

| Directory      | Purpose                                                  |
|----------------|----------------------------------------------------------|
| `pages/`       | MDX page files — each file is a route                    |
| `examples/`    | Live code examples grouped by category                   |
| `components/`  | Shared components (`LiveExample`, `QueryTabs`)           |
| `utils/`       | Mock API functions and helpers                           |
| `app/`         | Entry point (`main.tsx`) and root component (`App.tsx`)  |

**Entry point**: `main.tsx` renders `<App />` inside `<HeroUIProvider>` and `<BrowserRouter>`. `App.tsx` defines the navbar and `<Routes>`.

**Linked library**: `@fozy-labs/rx-toolkit` is linked via `"file:../.."`in `package.json` — imports resolve to the root `src/` of the monorepo.

**Type declarations**: `vite-env.d.ts` provides Vite client types (`/// <reference types="vite/client" />`) and declares `*.mdx` modules with a default `ComponentType` export.


## How to Add a New Page

1. Create a `.mdx` file in `src/pages/` (e.g., `EffectsPage.mdx`).
2. Import components and example namespaces at the top of the MDX file:
   ```mdx
   import { Tab } from "@heroui/react";
   import { LiveExample, QueryTabs } from "../components";
   import { Effects } from "../examples";
   ```
3. Write Markdown content and use `<LiveExample>` / `<QueryTabs>` JSX for interactive demos.
4. Import the page in `src/app/App.tsx`:
   ```tsx
   import EffectsPage from '../pages/EffectsPage.mdx';
   ```
5. Add a `<Route>` inside the `<Routes>` block:
   ```tsx
   <Route path="/effects" element={<EffectsPage />} />
   ```
6. Add a `<NavbarItem>` with a `<Link>` in the `<NavbarContent>` section of `App.tsx`:
   ```tsx
   <NavbarItem isActive={location.pathname === '/effects'}>
       <Link to="/effects" className={location.pathname === '/effects' ? 'text-primary' : 'text-foreground'}>
           Effects
       </Link>
   </NavbarItem>
   ```

The page component is the default export of the MDX file — no explicit export is needed.


## How to Add a New Example

1. Create a `.tsx` file in `src/examples/<category>/` (e.g., `src/examples/signals/my-example.tsx`).
2. Export a `function Base()` as the main component — this name is **required**. `LiveExample.processExample()` detects `function Base` and appends `render(Base);` for react-live's `noInline` mode.
   ```tsx
   import { Signal, useSignal } from "@fozy-labs/rx-toolkit";
   import { Button, Card, CardBody } from "@heroui/react";

   const counter$ = Signal.state(0);

   export function Base() {
       const count = useSignal(counter$);
       return (
           <Card>
               <CardBody>
                   <p>Count: {count}</p>
                   <Button onPress={() => counter$.set(count + 1)}>+</Button>
               </CardBody>
           </Card>
       );
   }
   ```
3. Import the raw file in the category's `index.ts` using the `?raw` suffix:
   ```typescript
   import myExampleRaw from "./my-example.tsx?raw";

   export const examples = {
       // ... existing examples
       myExample: myExampleRaw,
   };
   ```
4. If this is a new category, also export the namespace in `src/examples/index.ts`:
   ```typescript
   export * as MyCategory from "./my-category";
   ```
5. Reference the example in an MDX page via `<LiveExample>`:
   ```mdx
   <LiveExample title="My Example" initialCode={Signals.examples.myExample} />
   ```

**Important**: Import statements in example files are for readability and IDE support only. `processExample()` strips all `import ... from ...;` lines via regex. All identifiers must be available in the sandbox `scope` object (see next section).


## How to Add External Entities to the Sandbox Scope

The `react-live` `<LiveProvider>` in `LiveExample.tsx` receives a `defaultScope` object that provides all identifiers available at runtime in the sandbox.

To make a new entity available in examples:

1. Import it in `src/components/LiveExample.tsx`.
2. Add it to the `defaultScope` object inside the `LiveExample` component.

This applies to:
- New exports from `@fozy-labs/rx-toolkit`
- External package components (e.g., HeroUI components)
- Utilities (e.g., `fetches` from `../utils/fetches`)

Since `processExample()` strips import lines, the scope object is the **only** mechanism that provides identifiers to example code at runtime.


## Key Components

### `LiveExample`

Wraps `react-live` (`LiveProvider`, `LiveEditor`, `LivePreview`, `LiveError`) into a card layout with:
- **Import stripping**: `processExample()` removes all `import ... from ...;` lines via regex.
- **Auto-render**: If the code contains `function Base`, appends `render(Base);` automatically.
- **Scope injection**: All identifiers from `defaultScope` (rx-toolkit exports, HeroUI components, `fetches`, `React`) are injected into the sandbox.
- **Prism highlighting**: Uses `prism-react-renderer` with the `oneLight` theme.
- **Reset button**: Restores the editor to the initial code.

Props: `initialCode` (raw string), `scope` (additional scope entries), `noInline` (default `true`), `title`.

### `QueryTabs`

Tabbed container that syncs the active tab with the URL `?tab=` query parameter. Wraps HeroUI `<Tabs>` with:
- Reads initial tab from `window.location.search` on mount.
- Updates URL via `window.history.pushState` on tab change.

Usage in MDX:
```mdx
<QueryTabs>
    <Tab key="first" title="First">
        <LiveExample initialCode={...} />
    </Tab>
    <Tab key="second" title="Second">
        <LiveExample initialCode={...} />
    </Tab>
</QueryTabs>
```

Both components are re-exported from `components/index.ts`.


## Mock Utilities

`utils/fetches.ts` exports a `fetches` object with mock API functions for use in data fetching examples.

**Pattern**: Each function returns hardcoded data wrapped in a `Promise` with `setTimeout` to simulate network delay.

```typescript
export const fetches = {
    getItems: async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { items: [...] };
    },
    // ...
};
```

Available functions: `getItems`, `getCart`, `toggleCartItem`, `getUser`, `getUserStats`.

The `fetches` object is included in `LiveExample`'s `defaultScope` — examples access it directly without imports.
