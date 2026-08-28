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
        // `xstate` is a devDependency for the differential tests only. Test files
        // (`*.test.ts`, `__tests__/`) are outside ESLint's scope, so this guards
        // exactly the shipped code.
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
                    ],
                },
            ],
        },
    },
    { ignores: ["apps/", "src/**/__tests__/**"] },

];
