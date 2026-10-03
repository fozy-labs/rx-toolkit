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
        // Object.is: two Invalid Dates (NaN time) are equal, like two NaNs.
        return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
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

    // Keys are the whole state only of plain objects, user class instances and arrays. Built-ins
    // like File, Blob, URL, Error or Promise keep it in internal slots that Object.keys does not
    // see, so two distinct ones are compared by reference, and here they are distinct.
    if (!aIsMap && !aIsSet && !Array.isArray(a) && !(isPlainTagged(a) && isPlainTagged(b))) {
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

function isPlainTagged(value: object): boolean {
    return Object.prototype.toString.call(value) === "[object Object]";
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

function isStructural(value: unknown): boolean {
    return value !== null && (typeof value === "object" || typeof value === "function");
}

function mapsEqual(a: Map<unknown, unknown>, b: Map<unknown, unknown>, seen: SeenPairs): boolean {
    if (a.size !== b.size) {
        return false;
    }

    // Primitive keys compare through has/get — SameValueZero is what deepEqual
    // gives for them (incl. NaN and ±0), so the O(n²) structural search is left
    // to object keys only, over the object-keyed entries of b alone.
    let entriesB: [unknown, unknown][] | null = null;
    let used: boolean[] = [];

    outer: for (const [keyA, valueA] of a) {
        if (!isStructural(keyA)) {
            if (!b.has(keyA) || !deepEqualImpl(valueA, b.get(keyA), seen)) {
                return false;
            }
            continue;
        }

        if (entriesB === null) {
            entriesB = [];
            for (const entry of b) {
                if (isStructural(entry[0])) entriesB.push(entry);
            }
            used = new Array<boolean>(entriesB.length).fill(false);
        }

        // Жадный перебор с пометкой использованных записей: каждая запись из b
        // может быть сопоставлена только одной записи из a, иначе две разные
        // записи из a могли бы «схлопнуться» в одну запись из b.
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

    let valuesB: unknown[] | null = null;
    let used: boolean[] = [];

    outer: for (const valueA of a) {
        if (!isStructural(valueA)) {
            if (!b.has(valueA)) {
                return false;
            }
            continue;
        }

        if (valuesB === null) {
            valuesB = [];
            for (const valueB of b) {
                if (isStructural(valueB)) valuesB.push(valueB);
            }
            used = new Array<boolean>(valuesB.length).fill(false);
        }

        // The identical element wins without a structural walk; otherwise the
        // greedy match over the unused elements of b, as in mapsEqual.
        for (let i = 0; i < valuesB.length; i++) {
            if (!used[i] && valuesB[i] === valueA) {
                used[i] = true;
                continue outer;
            }
        }
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
