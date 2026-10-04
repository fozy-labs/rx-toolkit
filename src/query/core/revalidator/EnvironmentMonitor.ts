import type { IEnvironmentDriver, TEnvironmentState } from "@/query/types";
import { Batcher } from "@/signals";

export interface TEnvironmentEvent {
    /** visible or online changed — interval clocks must re-check eligibility */
    availabilityChanged: boolean;
    /** ms spent unfocused, set when this report is a focus transition */
    focusAwayMs: number | null;
    /** ms spent offline, set when this report is a reconnect transition */
    reconnectAwayMs: number | null;
}

const ALWAYS_AVAILABLE: TEnvironmentState = { visible: true, focused: true, online: true };

/**
 * Shares one lazy environment subscription across an Api's revalidating
 * resources, avoiding browser listeners for applications that never use it.
 */
export class EnvironmentMonitor {
    private _state: TEnvironmentState | null = null;
    private _connected = false;
    private _connecting = false;
    private _blurredAt: number | null = null;
    private _offlineAt: number | null = null;
    private readonly _listeners = new Set<(event: TEnvironmentEvent) => void>();

    constructor(private readonly _driver: IEnvironmentDriver | null) {}

    get state(): TEnvironmentState {
        if (this._driver === null) return ALWAYS_AVAILABLE;
        this._connect();
        return this._state!;
    }

    subscribe(listener: (event: TEnvironmentEvent) => void): () => void {
        if (this._driver === null) return () => {};
        this._listeners.add(listener);
        this._connect();
        return () => this._listeners.delete(listener);
    }

    private _connect(): void {
        if (this._connected || this._connecting || this._driver === null) return;
        this._connecting = true;
        let initial: TEnvironmentState;
        try {
            initial = this._driver.connect((next) => {
                if (!this._connecting) this._onChange(next);
            });
        } finally {
            this._connecting = false;
        }
        this._state = { ...initial };
        const now = Date.now();
        this._blurredAt = initial.focused ? null : now;
        this._offlineAt = initial.online ? null : now;
        this._connected = true;
    }

    private _onChange(next: TEnvironmentState): void {
        const previous = this._state!;
        if (previous.visible === next.visible && previous.focused === next.focused && previous.online === next.online) {
            return;
        }

        const now = Date.now();
        this._state = { ...next };
        if (previous.focused && !next.focused) this._blurredAt = now;
        if (previous.online && !next.online) this._offlineAt = now;

        const event: TEnvironmentEvent = {
            availabilityChanged: previous.visible !== next.visible || previous.online !== next.online,
            focusAwayMs: null,
            reconnectAwayMs: null,
        };
        if (!previous.focused && next.focused) {
            event.focusAwayMs = now - (this._blurredAt ?? now);
            this._blurredAt = null;
        }
        if (!previous.online && next.online) {
            event.reconnectAwayMs = now - (this._offlineAt ?? now);
            this._offlineAt = null;
        }

        Batcher.run(() => {
            for (const listener of this._listeners) {
                try {
                    listener(event);
                } catch (error) {
                    console.error("[EnvironmentMonitor] listener threw", error);
                }
            }
        });
    }
}
