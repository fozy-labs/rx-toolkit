import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
    // Global ignores
    {
        ignores: ["dist/", "coverage/", "apps/", "node_modules/", "**/*.test.ts", "src/__tests__/**"],
    },

    // Base JS rules
    js.configs.recommended,

    // TypeScript strict rules with typed linting
    ...tseslint.configs.strict,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    // Custom rule overrides
    {
        files: ["src/**/*.ts"],
        rules: {
            // Relax rules that don't fit the library's coding patterns
            // (specific rules to be determined after initial triage)
        },
    },

    // Prettier compatibility — must be last
    eslintConfigPrettier,
);
