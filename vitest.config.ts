import { defineConfig, mergeConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";
import sharedConfig from "@fozy-labs/js-configs/vitest";

export default mergeConfig(
    sharedConfig,
    defineConfig({
        resolve: {
            alias: {
                "@": fileURLToPath(new URL("./src", import.meta.url)),
            },
        },
        test: {
            coverage: {
                include: ["src/common/**", "src/signals/**", "src/query/**"],
            },
        },
    }),
);
