import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
    plugins: [react(), tailwindcss()],
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
    esbuild: {
        tsconfigRaw: {
            compilerOptions: {
                experimentalDecorators: true,
                useDefineForClassFields: false,
            },
        },
    },
});
