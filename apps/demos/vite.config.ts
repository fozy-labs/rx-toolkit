import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
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

