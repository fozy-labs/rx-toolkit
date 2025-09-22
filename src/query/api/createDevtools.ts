import { createDevtools as createRaDevtools } from "@reatom/devtools";

export function createDevtools() {
    return createRaDevtools({
        initVisibility: true,
    })
}
