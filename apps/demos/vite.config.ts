import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';

const librarySrc = fileURLToPath(new URL('../../src', import.meta.url));

// The demos run the library from its sources, as `tsconfig.json` types it: no
// build of `dist` is needed, and every importer (statechart-viz included) gets
// the same copy. `@/` is the library's own path alias.
const alias = [
    { find: /^@fozy-labs\/rx-toolkit$/, replacement: `${librarySrc}/index.ts` },
    { find: /^@\//, replacement: `${librarySrc}/` },
];

// The library sources live outside this project; their `react` / `rxjs` /
// `mermaid` imports would otherwise resolve to the repository root's own
// copies (two React runtimes).
const dedupe = ["react", "react-dom", "rxjs", "mermaid"];

// Pre-bundling would inline a second copy of the library sources into
// statechart-viz (a second signal engine next to the app's one), so viz is
// served unbundled; the dependencies it imports lazily are pre-bundled up front.
const optimizeDeps = {
    exclude: ['@fozy-labs/statechart-viz'],
    include: ['mermaid', '@fozy-labs/statechart-viz > @fozy-labs/statechart-converter'],
};

export default defineConfig({
    resolve: { alias, dedupe },
    optimizeDeps,
    plugins: [
        { enforce: 'pre', ...mdx() },
        react(),
        tailwindcss(),
    ],
    server: {
        port: 3000,
    },
    assetsInclude: ['**/*.tsx?raw'],
});
