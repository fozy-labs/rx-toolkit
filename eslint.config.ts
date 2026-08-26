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
    { ignores: ["apps/"] },

];
