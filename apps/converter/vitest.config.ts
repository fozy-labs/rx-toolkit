import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/** Root `src/` of the repository: the library at HEAD, not the root `dist/` build (no dependency on the build order). */
const LIBRARY_SRC = fileURLToPath(new URL("../../src/", import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            { find: /^@fozy-labs\/rx-toolkit$/, replacement: `${LIBRARY_SRC}index.ts` },
            // The root sources import each other through the `@/*` path alias.
            { find: /^@\//, replacement: LIBRARY_SRC },
        ],
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts", "test/**/*.test.ts"],
        // mermaid is loaded once per worker with jsdom globals installed by test/mermaidOracle.ts
        pool: "forks",
        testTimeout: 60_000,
    },
});
