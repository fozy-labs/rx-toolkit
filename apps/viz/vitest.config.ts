import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [react()],
    // See vite.config.ts: the library and the converter are symlinks; the
    // converter's `typescript` import is pinned to this package's copy.
    resolve: { dedupe: ["react", "react-dom", "rxjs", "typescript"] },
    test: {
        environment: "jsdom",
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        setupFiles: ["src/__tests__/setup.ts"],
        server: { deps: { inline: [/@fozy-labs[\/]rx-toolkit/] } },
        pool: "forks",
    },
});
