import { config } from "rxjs";

/**
 * Report an error nobody can handle synchronously the way RxJS reports one:
 * to `config.onUnhandledError` when it is set, else thrown from a `setTimeout`
 * so it reaches the host's global error handling.
 */
export function reportUnhandledError(error: unknown): void {
    if (config.onUnhandledError) {
        config.onUnhandledError(error);
        return;
    }
    setTimeout(() => {
        throw error;
    });
}
