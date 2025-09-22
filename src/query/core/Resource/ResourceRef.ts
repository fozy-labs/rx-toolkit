import { CoreResourceQueryCache, Resource } from "./Resource";
import { ResourceDefinition, ResourceRefInstanse } from "../../types/Resource.types";

export class ResourceRef<D extends ResourceDefinition> implements ResourceRefInstanse<D> {
    private _cacheItem: CoreResourceQueryCache<D> | null = null;

    constructor(
        private readonly _resource: Resource<D>,
        private readonly _args: D["Args"]
    ) {
    }

    get has() {
        if (this._cacheItem) return true;
        this._cacheItem = this._resource.getQueryCache(this._args) ?? null;
        return !!this._cacheItem;
    }

    lock() {
        this._cacheItem = this._resource.incrementLock(this._args, { cache: this._cacheItem ?? undefined });
        let isLocked = true;

        return {
            unlock: () => {
                if (!isLocked) return
                isLocked = false;
                this._resource.decrementLock(this._args, { cache: this._cacheItem! });
            }
        }
    }

    unlockOne() {
        this._cacheItem = this._resource.decrementLock(this._args, { cache: this._cacheItem! });
    }

    update(updateFn: (data: D["Data"]) => D["Data"]) {
        const cacheItem = this._cacheItem ?? this._resource.getQueryCache(this._args);

        if (!cacheItem) {
            console.warn('Trying to update non-existing cache item');
            return {
                rollback: () => {}
            }
        }

        const value = cacheItem.value;
        this._resource.updateData(this._args, updateFn, { cache: cacheItem });

        return {
            rollback: () => {
                this._resource.updateData(this._args, () => value.data, { cache: cacheItem });
            }
        }
    }

    create(data: D["Data"]): void {
        throw new Error("Method not implemented.");
    }

    invalidate(): void {
        throw new Error("Method not implemented.");
    }
}
