Configure repository development tooling:

1. **Test typing** — Set up proper TypeScript typing for test files (vitest globals, assertions, etc.)
2. **Linting** — Configure ESLint with presets, customized for this specific repository (TypeScript, React, import rules, etc.)
3. **Formatting** — Set up Prettier (or similar) including import sorting with the following order: external packages first, then "@/" aliases, then "../" relative imports, then "./" local imports, plus alphabetical sorting within groups.
4. **AI instructions for apps/demos** — Write `.github/instructions` files for AI agents working with `apps/demos/`, covering: how to add new pages, how to add external entities to the sandbox, etc. (requires `agent-customization` skill).
