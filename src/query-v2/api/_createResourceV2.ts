import { ResourceV2 } from "@/query-v2/core/resource/ResourceV2";
import type { IResourceV2, IResourceV2Options } from "@/query-v2/types";

export function _createResourceV2<TArgs, TData>(options: IResourceV2Options<TArgs, TData>): IResourceV2<TArgs, TData> {
    return new ResourceV2<TArgs, TData>(options);
}
