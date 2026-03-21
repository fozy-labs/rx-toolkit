# Task: Query v2 RFC Implementation Fixes

A set of issues identified against the query-v2 RFC implementation:

1. **React hooks must be available without a plugin** — Currently React hooks require a plugin to be registered. They should work out of the box without any plugin dependency.

2. **React hooks must live in a `react` folder** — Move React hooks into a dedicated `react/` directory within query-v2.

3. **Core must be explicitly split into `common`, `machines`, and `resource`** — The core module should have clear separation into three sub-modules: common utilities, state machines, and resource logic.

4. **DevTools must not receive agent state logs** — Agent state transitions/logs should not be sent to the devtools integration.

5. **Snapshot loading failure must produce an error** — When a snapshot cannot be loaded, an explicit error should be thrown/reported rather than silently failing.

6. **Key code locations must have JSDoc comments** — Important public APIs and critical internal logic should be documented with JSDoc.

7. **AI-generated RFC documentation must describe what gets included in a snapshot during optimistic updates** — All three generated doc files (excluding README.md) should document what data is captured in the snapshot when performing optimistic updates.
