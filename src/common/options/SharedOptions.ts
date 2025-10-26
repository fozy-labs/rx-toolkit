import { DevtoolsLike } from "@/common/devtools";

export class SharedOptions {
    static DEVTOOLS: DevtoolsLike | null = null
    static onQueryError: ((error: unknown) => void) | null = null;
}
