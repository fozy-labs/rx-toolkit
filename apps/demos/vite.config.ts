import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';

// `@fozy-labs/rx-toolkit` (link:../..) and `@fozy-labs/statechart-viz`
// (file:../viz) are symlinks; their `react` / `rxjs` / `mermaid` imports would
// otherwise resolve to the linked packages' own copies (two React runtimes).
const dedupe = ["react", "react-dom", "rxjs", "mermaid"];

export default defineConfig({
    resolve: { dedupe },
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

