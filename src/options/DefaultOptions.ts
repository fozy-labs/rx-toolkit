import type { DevtoolsLike } from "@/devtools";
import { SharedOptions } from "./SharedOptions";

type Update = Partial<{
    DEVTOOLS: DevtoolsLike | null;
    onError: (error: unknown) => void;
}>

export class DefaultOptions {
    static update(part : Update) {
        if (part.DEVTOOLS !== undefined) SharedOptions.DEVTOOLS = part.DEVTOOLS;
        if (part.onError !== undefined) SharedOptions.onError = part.onError;
    }
}
