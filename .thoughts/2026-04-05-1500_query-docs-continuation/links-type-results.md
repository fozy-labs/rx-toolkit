# Links API — Type Inference Results

Compiled with `tsc --noEmit --strict` — **0 errors**.

## Scorecard

| # | Approach | TCommandArgs inferred? | TResArgs checked? | DX |
|---|----------|----------------------|-------------------|-----|
| 1A | `resource.link(config)` | ❌ unknown | ✅ | bad — cast needed |
| 1B | `resource.linkGeneric<T>(config)` | ✅ (manual) | ✅ | ok — duplicates type |
| 2 | `createLink(resource, config)` | ❌ unknown | ✅ | bad — same as 1A |
| 3 | inline `{ resource, forwardArgs }` | ✅ auto | ❌ any[] erases | mixed |
| 4 | `resource.link()` → builder + inline | ✅ auto | ❌ any[] erases | mixed |
| 5 | `resource.link<TCmd>(config)` | ✅ (manual) | ✅ | ok — explicit generic |
| **6** | **callback `links: (link) => {}`** | **✅ auto** | **✅** | **best** |

## Key Finding

**The fundamental tension**: `resource.link()` and `createLink()` are called _before_ TS resolves the command's `TArgs`, so `TCommandArgs` cannot flow into them. Any approach that returns an opaque `LinkDeclaration` erases the generic context.

**Approach 6 wins** because the callback defers evaluation — `createCommand` resolves `TArgs` first, then passes a pre-typed `link` function into the callback. Each `link(resource, config)` call independently captures `TResArgs` from the resource argument.

## Recommended API Shape

```ts
createCommand({
  handler: async (args: { userId: string; newName: string }) => { ... },
  links: (link) => {
    link(userResource, {
      forwardArgs: (commandArgs) => ({ userId: commandArgs.userId }),
      invalidate: true,
    });
  },
});
```

Full auto-inference, full type safety, zero explicit generics needed.
