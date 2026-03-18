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
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-extraneous-class": "off",
            "@typescript-eslint/no-dynamic-delete": "off",
            "@typescript-eslint/no-invalid-void-type": "off",
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
                destructuredArrayIgnorePattern: "^_",
            }],
        },
    },

    // Prettier compatibility — must be last
    eslintConfigPrettier,
);
