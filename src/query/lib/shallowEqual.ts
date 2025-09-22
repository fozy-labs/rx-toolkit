
export function shallowEqual(
    a: unknown,
    b: unknown,
): boolean {
    if (a === b) {
        return true;
    }

    if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
        return false;
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) {
        return false;
    }

    for (let i = 0; i < keysA.length; i++) {
        const key = keysA[i];
        // @ts-ignore
        if (!Object.prototype.hasOwnProperty.call(b, key) || a[key] !== b[key]) {
            return false;
        }
    }

    return true;
}
