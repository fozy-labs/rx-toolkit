import type { ArgsOrVoid, IPatchHandle, IResource, IResourceRef } from "@/query/types";

export class ResourceRef<RArgs, RData> implements IResourceRef<RData> {
    private _resource: IResource<RArgs, RData>;
    private _args: RArgs;

    constructor(resource: IResource<RArgs, RData>, args: RArgs) {
        this._resource = resource;
        this._args = args;
    }

    /** Invalidate the linked resource for these args */
    invalidate(): void {
        this._resource.invalidate(...([this._args] as ArgsOrVoid<RArgs>));
    }

    /** Create patch on the linked resource entry. Returns null if no entry or no data. */
    patch(patchFn: (draft: RData) => void): IPatchHandle | null {
        const entry = this._resource.getEntry(...([this._args] as ArgsOrVoid<RArgs>));
        if (!entry) {
            return null;
        }
        return entry.createPatch(patchFn);
    }
}
