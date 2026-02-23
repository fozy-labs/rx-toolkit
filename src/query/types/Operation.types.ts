import {
    CommandCreateFn,
    CommandCreateOptions,
    CommandDefinition,
    CommandInstance,
    CommandAgentInstance,
    CommandQueryState,
} from './Command.types';

/** @deprecated Use `CommandCreateFn` instead. Will be removed in v0.6.0. */
export type OperationCreateFn<
    ARGS,
    RESULT,
    SELECTED = never,
> = CommandCreateFn<ARGS, RESULT, SELECTED>;

/** @deprecated Use `CommandCreateOptions` instead. Will be removed in v0.6.0. */
export type OperationCreateOptions<D extends CommandDefinition> = CommandCreateOptions<D>;

/** @deprecated Use `CommandDefinition` instead. Will be removed in v0.6.0. */
export type OperationDefinition<A = any, R = any, S = any> = CommandDefinition<A, R, S>;

/** @deprecated Use `CommandInstance` instead. Will be removed in v0.6.0. */
export type OperationInstance<D extends CommandDefinition> = CommandInstance<D>;

/** @deprecated Use `CommandAgentInstance` instead. Will be removed in v0.6.0. */
export type OperationAgentInstanse<D extends CommandDefinition> = CommandAgentInstance<D>;

/** @deprecated Use `CommandQueryState` instead. Will be removed in v0.6.0. */
export type OperationQueryState<D extends CommandDefinition> = CommandQueryState<D>;
