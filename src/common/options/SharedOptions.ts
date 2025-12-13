import { DevtoolsLike } from "@/common/devtools";
import { shallowEqual } from "@/common/utils";

export class SharedOptions {
    static DEVTOOLS: DevtoolsLike | null = null
    static onQueryError: ((error: unknown) => void) | null = null;
    static getScopeName: (() => string | null) | null = null;
    static defaultCompareArgs = shallowEqual;
}
