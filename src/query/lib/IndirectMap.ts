import { shallowEqual } from "@/common/utils";

type CompareFn<T> = (a: T, b: T) => boolean;

export class IndirectMap<KEY, VALUE> {
    private _compareCache = new WeakMap<object, KEY>();
    private _map = new Map<KEY, VALUE>();

    constructor(
        private _compareObjectsFn: CompareFn<KEY> = shallowEqual,
    ) {}

    private _getCachedKey(key: KEY): KEY | undefined {
        const cachedKey = this._compareCache.get(key as object);

        if (cachedKey) {
            return cachedKey;
        }

        for (const cachedKey of this._map.keys()) {
            if (this._compareObjectsFn(key, cachedKey)) {
                this._compareCache.set(key as object, cachedKey);
                return cachedKey;
            }
        }

        return undefined;
    }

    get(key: KEY): VALUE | undefined {
        const item = this._map.get(key)

        if (!item) {
            const isObject = typeof key === 'object' && key !== null

            if (!isObject) {
                return undefined;
            }

            const cachedKey = this._getCachedKey(key);

            if (!cachedKey) {
                return undefined;
            }

            return this._map.get(cachedKey);
        }

        return item
    }

    set(key: KEY, value: VALUE): void {
        const has = this._map.has(key)

        if (has) {
            this._map.set(key, value);
        } else {
            const isObject = typeof key === 'object' && key !== null

            if (!isObject) {
                this._map.set(key, value);
                return;
            }

            const cachedKey = this._getCachedKey(key);

            if (cachedKey) {
                this._map.set(cachedKey, value);
            } else {
                this._map.set(key, value);
                this._compareCache.set(key as object, key);
            }
        }
    }

    /**
     * Удаляет элемент из кеша, не зависимо от того,
     *  ссылается ли на него другой объект или нет
     * @param key
     */
    delete(key: KEY): void {
        const isObject = typeof key === 'object' && key !== null

        if (isObject) {
            const cachedKey = this._getCachedKey(key);

            if (cachedKey) {
                this._map.delete(cachedKey);
                this._compareCache.delete(key as object);
            }
        }

        this._map.delete(key)
    }

    has(key: KEY): boolean {
        const has = this._map.has(key);

        if (!has && typeof key === 'object' && key !== null) {
            const cachedKey = this._getCachedKey(key);

            if (!cachedKey) {
                return false;
            }

            return this._map.has(cachedKey);
        }

        return has;
    }

    get values(): IterableIterator<VALUE> {
        return this._map.values();
    }
}
