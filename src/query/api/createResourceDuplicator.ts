import {
    DuplicatorOptions,
    ResourceDuplicator,
    DuplicatorDefinition
} from "@/query/core/Resource/ResourceDuplicator";
import { ResourceDefinition } from "@/query/types";

export const createResourceDuplicator = (
    <ARGS, RESULT, SELECTED = never>(
        options: DuplicatorOptions<DuplicatorDefinition<ResourceDefinition<ARGS, RESULT, SELECTED>>>
    ) => new ResourceDuplicator(options)
) satisfies ResourceDuplicatorCreateFn<any, any, any>;

export type ResourceDuplicatorCreateFn<
    ARGS,
    RESULT,
    SELECTED = never
> = (
    options: DuplicatorOptions<DuplicatorDefinition<ResourceDefinition<ARGS, RESULT, SELECTED>>>
) => ResourceDuplicator<DuplicatorDefinition<ResourceDefinition<ARGS, RESULT, SELECTED>>>;
