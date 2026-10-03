import sharedConfig from "@fozy-labs/js-configs/eslint";

export default [
    ...sharedConfig,
    {
        languageOptions: {
            parserOptions: {
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-useless-constructor": "off",
            "@typescript-eslint/unified-signatures": "off",
        },
    },
    {
        // Devtime-only packages: `xstate` and `@preact/signals-core` back the
        // differential tests, `zod` the schema tests (shipped code speaks
        // Standard Schema instead). Test files (`*.test.ts`, `__tests__/`)
        // are outside ESLint's scope, so this guards exactly the shipped code.
        files: ["src/**/*.ts", "src/**/*.tsx"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["xstate", "xstate/*"],
                            message: "xstate is a devDependency: import it from test files only.",
                        },
                        {
                            group: ["@preact/signals-core"],
                            message: "@preact/signals-core is a devDependency: import it from test files only.",
                        },
                        {
                            group: ["zod", "zod/*"],
                            message: "zod is a devDependency: import it from test files only; use Standard Schema.",
                        },
                    ],
                },
            ],
        },
    },
    { ignores: ["apps/", "src/**/__tests__/**"] },
];
