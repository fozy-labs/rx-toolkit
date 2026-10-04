import type { IEnvironmentDriver, TEnvironmentState } from "@/query/types";

function read(): TEnvironmentState {
    const visible = typeof document !== "undefined" && document.visibilityState !== "hidden";
    const focused = visible && (typeof document.hasFocus !== "function" || document.hasFocus());
    const online = typeof navigator === "undefined" || navigator.onLine !== false;

    return { visible, focused, online };
}

/**
 * Read visibility, focus and connectivity from browser globals. `disconnect`
 * is available for user teardown and tests; the query core keeps the driver
 * connected once it is first needed.
 */
export function browserEnvironmentDriver(): IEnvironmentDriver {
    let onChange: ((state: TEnvironmentState) => void) | null = null;
    const update = (): void => onChange?.(read());

    return {
        connect(callback) {
            onChange = callback;
            if (typeof document !== "undefined") {
                document.addEventListener("visibilitychange", update);
            }
            if (typeof window !== "undefined") {
                window.addEventListener("focus", update);
                window.addEventListener("blur", update);
                window.addEventListener("online", update);
                window.addEventListener("offline", update);
            }
            return read();
        },
        disconnect() {
            if (typeof document !== "undefined") {
                document.removeEventListener("visibilitychange", update);
            }
            if (typeof window !== "undefined") {
                window.removeEventListener("focus", update);
                window.removeEventListener("blur", update);
                window.removeEventListener("online", update);
                window.removeEventListener("offline", update);
            }
            onChange = null;
        },
    };
}
