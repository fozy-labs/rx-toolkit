import type { ArgsOrVoid, IPatchHandle, IResourceV2, IResourceV2Ref } from "@/query-v2/types";

export class ResourceV2Ref<RArgs, RData> implements IResourceV2Ref<RData> {
    private _resource: IResourceV2<RArgs, RData>;
    private _args: RArgs;

    constructor(resource: IResourceV2<RArgs, RData>, args: RArgs) {
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
