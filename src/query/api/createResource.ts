import { Resource } from "@/query/core/Resource/Resource";
import type { ResourceCreateFn, ResourceCreateOptions, ResourceDefinition } from "@/query/types";

export const createResource = (<ARGS, RESULT, SELECTED = never>(
    options: ResourceCreateOptions<ResourceDefinition<ARGS, RESULT, SELECTED>>,
) => new Resource(options)) satisfies ResourceCreateFn<any, any, any>;
