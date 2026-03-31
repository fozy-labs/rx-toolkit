import { Resource } from "@/query/core/resource/Resource";
import type { IResource, TResourceOptions } from "@/query/types";

export function _createResource<TArgs = void, TData = unknown>(
    options: TResourceOptions<TArgs, TData>,
): IResource<TArgs, TData> {
    return new Resource<TArgs, TData>(options);
}
