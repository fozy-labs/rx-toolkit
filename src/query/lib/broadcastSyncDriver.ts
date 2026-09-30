import type { ISyncDriver, ISyncMessage } from "../types";

export interface BroadcastSyncDriverOptions {
    /** `BroadcastChannel` name. Defaults to `rx-toolkit:{keyPrefix}`, or `rx-toolkit` for an api without one. */
    channel?: string;
}

function isValidSyncMessage(msg: unknown): msg is ISyncMessage {
    if (msg == null || typeof msg !== "object") return false;
    const m = msg as Record<string, unknown>;
    return (
        (m.type === "REQ" || m.type === "RES") &&
        typeof m.reqId === "string" &&
        Array.isArray(m.keys) &&
        m.keys.length === 3 &&
        m.keys.every((k: unknown) => typeof k === "string")
    );
}

export function broadcastSyncDriver(options?: BroadcastSyncDriverOptions): ISyncDriver {
    let bc: BroadcastChannel | null = null;

    return {
        connect(onMessage, { keyPrefix }) {
            const channelName = options?.channel ?? (keyPrefix ? `rx-toolkit:${keyPrefix}` : "rx-toolkit");
            try {
                bc = new BroadcastChannel(channelName);
                bc.onmessage = (ev: MessageEvent) => {
                    if (isValidSyncMessage(ev.data)) {
                        onMessage(ev.data);
                    }
                };
            } catch {
                bc = null;
            }
        },
        disconnect() {
            try {
                bc?.close();
            } catch {
                /* noop */
            }
            bc = null;
        },
        send(message) {
            try {
                bc?.postMessage(message);
            } catch {
                /* noop — channel may be closed or unavailable */
            }
        },
    };
}
