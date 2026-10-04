// A consumer of the query module: every export is left to inference, so its declaration names
// the clutch and entry states — whole and narrowed. `declarations.test.ts` compiles it against
// the built package, with `@/index` replaced by the package name.
import {
    createApi,
    type IEnvironmentDriver,
    type TCommandClutchState,
    type TEnvironmentState,
    type TInvalidateOnOptions,
    type TProjectionResourceOptions,
    type TResourceClutchState,
    type TResourceEntryState,
} from "@/index";
import { reactHooksPlugin } from "@/react";

type Args = number;
type Data = { name: string };

export const api = createApi({ plugins: [reactHooksPlugin()] });

export const environmentDriver: IEnvironmentDriver = {
    connect: (_onChange: (state: TEnvironmentState) => void) => ({ visible: true, focused: true, online: true }),
    disconnect: () => {},
};

export const revalidatingApi = createApi({
    environmentDriver,
    invalidateOn: { focus: true, reconnect: 1_000, interval: 5_000 },
});

export const user = api.createResource({
    queryFn: async (id: Args): Promise<Data> => ({ name: String(id) }),
});

export const revalidatingUser = revalidatingApi.createResource({
    queryFn: async (id: Args): Promise<Data> => ({ name: String(id) }),
    invalidateOn: { focus: (_args, state) => state.updatedAt === null },
});

export const invalidatePolicy: TInvalidateOnOptions<Args, Data> = {
    reconnect: (_args, state) => state.hasData && state.updatedAt > 0,
};

type TProjectionHasInvalidateOn = "invalidateOn" extends keyof TProjectionResourceOptions<
    number[],
    number,
    Data,
    Args,
    Data
>
    ? true
    : false;

export const projectionHasNoInvalidateOn: TProjectionHasInvalidateOn = false;

export const save = api.createCommand({ queryFn: async (id: Args): Promise<Data> => ({ name: String(id) }) });

export function useUser(id: Args) {
    return user.useResource(id);
}

export function useSuspenseUser(id: Args) {
    return user.useSuspenseResource(id);
}

export function useSave() {
    return save.useCommand();
}

export const entry = user.getState(1);

export function failedClutch(state: TResourceClutchState<Args, Data>) {
    return state.hasError ? state : null;
}

export function pendingClutch(state: TResourceClutchState<Args, Data>) {
    return state.isPending ? state : null;
}

export function shownClutch(state: TResourceClutchState<Args, Data>) {
    return state.hasData ? state : null;
}

export function failedCommand(state: TCommandClutchState<Args, Data>) {
    return state.hasError ? state : null;
}

export function pendingCommand(state: TCommandClutchState<Args, Data>) {
    return state.status === "pending" ? state : null;
}

export function failedEntry(state: TResourceEntryState<Args, Data>) {
    return state.status === "error" ? state : null;
}

export function pendingEntry(state: TResourceEntryState<Args, Data>) {
    return state.isPending ? state : null;
}
