import { DevtoolsLike } from "@/common/devtools";

export class SharedOptions {
    static DEVTOOLS: DevtoolsLike | null = null;
    static onQueryError: ((error: unknown) => void) | null = null;
    static getScopeName: (() => string | null) | null = null;

    static reset(): void {
        SharedOptions.DEVTOOLS = null;
        SharedOptions.onQueryError = null;
        SharedOptions.getScopeName = null;
    }
}
