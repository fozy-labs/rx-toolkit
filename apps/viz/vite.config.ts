import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `@fozy-labs/rx-toolkit` is installed as `file:../..` (a symlink to the repo
// root); without dedupe its `react`/`rxjs` imports would resolve to the root's
// copies and React would see two runtimes.
//
// `@fozy-labs/statechart-converter` is `file:../converter` (a symlink to
// apps/converter). It imports the `typescript` compiler API, a CommonJS
// package that Vite can serve to the browser only through the dep optimizer.
// `optimizeDeps.include` pre-bundles `typescript` at server start instead of
// discovering it on the first lazy `import()` of the converter (which would be
// a "new dependencies optimized" full reload in the middle of an e2e test),
// and `dedupe` pins the converter's `typescript` import to this package's copy
// (the same pinned version) so that it resolves to that pre-bundled module and
// not to apps/converter/node_modules. The converter itself is not pre-bundled:
// served from source, a linked package picks up a rebuilt dist without
// `--force`.
const dedupe = ["react", "react-dom", "rxjs", "typescript"];

export default defineConfig({
    plugins: [react()],
    resolve: { dedupe },
    optimizeDeps: { include: ["typescript"] },
    server: { port: 3100, strictPort: false },
    build: {
        lib: {
            entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
            formats: ["es"],
            fileName: "index",
        },
        sourcemap: true,
        rollupOptions: {
            // The converter and its `typescript` dependency are loaded lazily by
            // `source` mode and must never end up in the library bundle.
            external: [
                "react",
                "react-dom",
                "react/jsx-runtime",
                "rxjs",
                "mermaid",
                "@fozy-labs/rx-toolkit",
                "@fozy-labs/statechart-converter",
                "typescript",
            ],
        },
    },
});
