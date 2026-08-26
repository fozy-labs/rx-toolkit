export interface DevtoolsStateLike<T = any> {
    (newState: T, actionName?: string): void;
}
export interface DevtoolsLike {
    state<T>(name: string, initState: T): DevtoolsStateLike<T>;
}
