import type { DevtoolsLike } from "@/common/devtools";
import { SharedOptions } from "./SharedOptions";

type Update = Partial<{
    DEVTOOLS: DevtoolsLike | null;
    onQueryError: (error: unknown) => void;
}>

export class DefaultOptions {
    static update(part : Update) {
        if (part.DEVTOOLS !== undefined) SharedOptions.DEVTOOLS = part.DEVTOOLS;
        if (part.onQueryError !== undefined) SharedOptions.onQueryError = part.onQueryError;
    }
}
