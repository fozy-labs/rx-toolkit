import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
    // Global ignores
    {
        ignores: ["node_modules/"],
    },

    // Base JS rules
    js.configs.recommended,

    // TypeScript recommended rules (less strict for demos)
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    // React Hooks rules
    {
        files: ["src/**/*.{ts,tsx}"],
        plugins: {
            "react-hooks": reactHooks,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
        },
    },

    // Prettier compatibility — must be last
    eslintConfigPrettier,
);
