/**
 * `crypto.randomUUID()` when available, otherwise a v4-shaped UUID from
 * `getRandomValues`/`Math.random`. `randomUUID` is missing outside secure
 * contexts (plain HTTP), in Node < 19 and in React Native.
 */
export function randomUUID(): string {
    const cryptoApi = typeof crypto === "undefined" ? undefined : crypto;

    if (typeof cryptoApi?.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (typeof cryptoApi?.getRandomValues === "function") {
        cryptoApi.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
