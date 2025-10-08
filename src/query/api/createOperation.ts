import type { OperationCreateFn, OperationCreateOptions, OperationDefinition } from "@/query/types";
import { Operation } from "@/query/core/Opertation/Operation";

export const createOperation = (
    <ARGS, RESULT, SELECTED = never>(
        options: OperationCreateOptions<OperationDefinition<ARGS, RESULT, SELECTED>>
    ) => new Operation(options)
) satisfies OperationCreateFn<any, any, any>;
