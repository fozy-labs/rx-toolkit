import type { ResourceCreateFn, ResourceCreateOptions, ResourceDefinition } from "@/query/types";
import { Resource } from "@/query/core/Resource/Resource";

export const createResource = (
    <ARGS, RESULT, SELECTED = never>(
        options: ResourceCreateOptions<ResourceDefinition<ARGS, RESULT, SELECTED>>
    ) => new Resource(options)
) satisfies ResourceCreateFn<any, any, any>;

