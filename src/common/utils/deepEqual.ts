type SeenPairs = Map<object, Set<object>>;

export function deepEqual(a: unknown, b: unknown): boolean {
    return deepEqualImpl(a, b, new Map());
}

function deepEqualImpl(a: unknown, b: unknown, seen: SeenPairs): boolean {
    if (a === b) {
        return true;
    }

    if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
        // NaN — единственное значение, не равное самому себе
        return a !== a && b !== b;
    }

    if (Array.isArray(a) !== Array.isArray(b)) {
        return false;
    }

    if (a instanceof Date || b instanceof Date) {
        return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    }

    if (a instanceof RegExp || b instanceof RegExp) {
        return a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags;
    }

    const aIsMap = a instanceof Map;
    const bIsMap = b instanceof Map;

    if (aIsMap !== bIsMap) {
        return false;
    }

    const aIsSet = a instanceof Set;
    const bIsSet = b instanceof Set;

    if (aIsSet !== bIsSet) {
        return false;
    }

    // Защита от циклов: пара, которая уже сравнивается выше по стеку,
    // считается равной — расхождение обнаружится по другим полям.
    let seenForA = seen.get(a);

    if (seenForA?.has(b)) {
        return true;
    }

    if (!seenForA) {
        seenForA = new Set();
        seen.set(a, seenForA);
    }

    seenForA.add(b);

    let result: boolean;

    if (aIsMap && bIsMap) {
        result = mapsEqual(a, b, seen);
    } else if (aIsSet && bIsSet) {
        result = setsEqual(a, b, seen);
    } else {
        result = objectsEqual(a, b, seen);
    }

    // Пара удаляется на выходе: запись в seen означает «сравнение в процессе»,
    // а не мемоизацию результата.
    seenForA.delete(b);

    if (seenForA.size === 0) {
        seen.delete(a);
    }

    return result;
}

function objectsEqual(a: object, b: object, seen: SeenPairs): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) {
        return false;
    }

    for (let i = 0; i < keysA.length; i++) {
        const key = keysA[i];

        if (!Object.prototype.hasOwnProperty.call(b, key)) {
            return false;
        }

        const valueA = (a as Record<string, unknown>)[key];
        const valueB = (b as Record<string, unknown>)[key];

        if (!deepEqualImpl(valueA, valueB, seen)) {
            return false;
        }
    }

    return true;
}

function mapsEqual(a: Map<unknown, unknown>, b: Map<unknown, unknown>, seen: SeenPairs): boolean {
    if (a.size !== b.size) {
        return false;
    }

    // Жадный перебор с пометкой использованных записей: каждая запись из b
    // может быть сопоставлена только одной записи из a, иначе две разные
    // записи из a могли бы «схлопнуться» в одну запись из b.
    const entriesB = [...b];
    const used = new Array<boolean>(entriesB.length).fill(false);

    outer: for (const [keyA, valueA] of a) {
        for (let i = 0; i < entriesB.length; i++) {
            if (used[i]) {
                continue;
            }

            const [keyB, valueB] = entriesB[i];

            if (deepEqualImpl(keyA, keyB, seen) && deepEqualImpl(valueA, valueB, seen)) {
                used[i] = true;
                continue outer;
            }
        }

        return false;
    }

    return true;
}

function setsEqual(a: Set<unknown>, b: Set<unknown>, seen: SeenPairs): boolean {
    if (a.size !== b.size) {
        return false;
    }

    const valuesB = [...b];
    const used = new Array<boolean>(valuesB.length).fill(false);

    outer: for (const valueA of a) {
        for (let i = 0; i < valuesB.length; i++) {
            if (used[i]) {
                continue;
            }

            if (deepEqualImpl(valueA, valuesB[i], seen)) {
                used[i] = true;
                continue outer;
            }
        }

        return false;
    }

    return true;
}
