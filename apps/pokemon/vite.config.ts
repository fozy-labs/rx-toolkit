import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

/**
 * Workaround for simplest-di@0.2.1 build bug:
 * Internal files import `from "../react"` which resolves to the package's own
 * `dist/react/index.js` instead of the external `react` package.
 * We rewrite these imports before both esbuild (dev) and Rollup (build) see them.
 */
function fixSimplestDiReactImport(): Plugin {
    return {
        name: 'fix-simplest-di-react-import',
        enforce: 'pre',
        transform(code, id) {
            if (id.includes('@fozy-labs/simplest-di') && code.includes('"../react"')) {
                return code.replace(/from\s+"\.\.\/react"/g, 'from "react"');
            }
            return null;
        },
    };
}

export default defineConfig({
    plugins: [fixSimplestDiReactImport(), react(), tailwindcss()],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
    optimizeDeps: {
        // Don't let esbuild pre-bundle simplest-di — let our plugin fix its
        // broken imports first, then Vite will serve the transformed modules.
        exclude: ['@fozy-labs/simplest-di'],
    },
    server: {
        port: 3737,
    },
});
