import type { OperationCreateFn, OperationCreateOptions, OperationDefinition } from "query/types/Operation.types";
import { Operation } from "query/core/Opertation/Operation";

export const createOperation = (
    <ARGS, RESULT, SELECTED = never>(
        options: OperationCreateOptions<OperationDefinition<ARGS, RESULT, SELECTED>>
    ) => new Operation(options)
) satisfies OperationCreateFn<any, any, any>;

/**
 * @deprecated Use `createOperation` instead.
 */
export const createMutationApi = createOperation;
