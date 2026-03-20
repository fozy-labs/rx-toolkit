import sharedConfig from "@fozy-labs/js-configs/eslint";

export default [
    ...sharedConfig,
    {
        languageOptions: {
            parserOptions: {
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    { ignores: ["apps/"] },
];
