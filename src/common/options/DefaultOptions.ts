import type { DevtoolsLike } from "@/common/devtools";
import { SharedOptions } from "./SharedOptions";
import { Observable } from "rxjs";

type Update = Partial<{
    DEVTOOLS: DevtoolsLike | null;
    onQueryError: (error: unknown) => void;
    getScopeName: () => string | null;
    getScopeDestroyed$: () => Observable<void> | null;
}>

export class DefaultOptions {
    static update(part : Update) {
        if (part.DEVTOOLS !== undefined) SharedOptions.DEVTOOLS = part.DEVTOOLS;
        if (part.onQueryError !== undefined) SharedOptions.onQueryError = part.onQueryError;
        if (part.getScopeName !== undefined) SharedOptions.getScopeName = part.getScopeName;
        if (part.getScopeDestroyed$ !== undefined) SharedOptions.getScopeDestroyed$ = part.getScopeDestroyed$;
    }
}
