import React from "react";

export function useUnmount(fn: () => void, deps = [] as any[]): void {
    const preventUnmountRef = React.useRef<null | (() => void)>(null);

    React.useEffect(() => {
        return () => {
            let isPrevented = false;

            preventUnmountRef.current = () => {
                isPrevented = true;
            }

            new Promise<void>((resolve) => {
                resolve();
            }).then(() => {
                if (isPrevented) return;
                preventUnmountRef.current = null;
                fn();
            });
        }
    }, deps);

    React.useEffect(() => {
        preventUnmountRef.current?.();
        preventUnmountRef.current = null;
    }, deps);
}
