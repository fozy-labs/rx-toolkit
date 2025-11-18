import { DevtoolsLike } from "@/common/devtools";
import { Observable } from "rxjs";

export class SharedOptions {
    static DEVTOOLS: DevtoolsLike | null = null
    static onQueryError: ((error: unknown) => void) | null = null;
    static getScopeName: () => string | null;
    static getScopeDestroyed$: () => Observable<void> | null;
}
