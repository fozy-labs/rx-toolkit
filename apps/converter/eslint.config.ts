import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
    // Global ignores
    {
        ignores: ["node_modules/", "dist/", "test/__snapshots__/"],
    },

    // Base JS rules
    js.configs.recommended,

    // TypeScript recommended rules (mirrors apps/demos)
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    {
        files: ["src/**/*.ts", "test/**/*.ts"],
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
        },
    },

    // Prettier compatibility — must be last
    eslintConfigPrettier,
);
