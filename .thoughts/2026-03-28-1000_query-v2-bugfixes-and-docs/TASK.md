# Task

Fix the following problems in query-v2:

1. When using `createApi({ initialSnapshot })`, `queryFn` is still called even when the snapshot falls within `maxSnapshotDataAge`.
2. A junior developer reported that the `onQueryStarted` lifecycle hook is never called (dead code). Need to investigate whether there is a real problem or not.
3. Junior feedback: "SWR masks `isError` when an `error` object is present."
4. Junior feedback: "Consistency violation on commit is lost in Patcher."
5. `$cacheDataLoaded` promise hangs on `resetCache`.
6. Documentation for query-v2 is outdated.
7. Missing interactive examples (visual, without commands/mutations).
