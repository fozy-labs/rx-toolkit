import React from "react";

export function useEventHandler<T extends (...args: any[]) => any>(fn: T) {
    const ref = React.useRef<T>(fn);
    ref.current = fn;

    return React.useCallback((...args: unknown[]) => ref.current(...args), []) as T;
}
