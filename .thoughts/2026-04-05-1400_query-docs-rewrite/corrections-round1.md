# Corrections to apply

## docs/query/README.md fixes
1. "ресурс" and "команда" should be reference-style links to usage/resource.md and usage/command.md (not bold or backtick)
2. All links must be reference-style (declared at end of document)

## docs/query/concepts/architecture.md fixes
1. MUST NOT copy/duplicate the intro description from README.md — reference it or skip it
2. Remove "plugin.install()" from diagram — this method will be removed
3. In diagram: `getEntry$(args)` calls `get(args)`, NOT `getOrCreate(args)`. Returns `CacheEntry | null`
4. "Поток данных" sequence diagram needs more arrows/cases — it's incomplete
5. `createResource` and `createCommand` are METHODS of api object, not standalone functions. Fix diagram/text.
6. Snapshot utilities (initialSnapshot, api.getSnapshot()) are NOT separate utilities — they're part of the API
7. "Обзор компонентов" section lacks logical sequence — restructure or replace with a better diagram
8. Don't do BOTH description AND diagram for the same content — choose diagram when both overlap
9. All links must be reference-style

## Style rules (apply to ALL docs going forward)
- Reference-style links only: `[text][ref]` in body, `[ref]: url` at end
- No duplication across files — cross-reference instead
- Prefer diagram over prose when both say the same thing
- Check common-mistakes.md before writing any doc
