import type { AfterEvent, DoneStateEvent, InitEvent, StopEvent } from "../types";

export const STATE_DELIMITER = ".";
export const STATE_IDENTIFIER = "#";
export const WILDCARD = "*";
/** Descriptor of eventless (`always`) transitions. */
export const NULL_EVENT = "";
export const XSTATE_INIT = "xstate.init";
export const XSTATE_STOP = "xstate.stop";
/** Root id when the config declares none (XState default). */
export const DEFAULT_MACHINE_ID = "(machine)";
export const DEFAULT_MAX_MICROSTEPS = 10_000;

/**
 * Port of XState `createInitEvent(input)`: the `input` key is always present
 * on the object. Actor `input` is unsupported here, so it is always
 * `undefined` — but code inspecting keys (`"input" in event`, `Object.keys`)
 * sees the same shape as with XState.
 */
export function createInitEvent(): InitEvent {
    return { type: XSTATE_INIT, input: undefined };
}

export function createStopEvent(): StopEvent {
    return { type: XSTATE_STOP };
}

/**
 * `xstate.after.<delayRef>.<stateNodeId>` — `delayRef` is the `after` key as
 * written in the config: numeric keys as numbers (`3000`), named delays as-is.
 */
export function createAfterEventType(delayRef: string | number, stateNodeId: string): AfterEvent["type"] {
    return `xstate.after.${delayRef}.${stateNodeId}`;
}

export function createAfterEvent(delayRef: string | number, stateNodeId: string): AfterEvent {
    return { type: createAfterEventType(delayRef, stateNodeId) };
}

export function createDoneStateEventType(stateNodeId: string): DoneStateEvent["type"] {
    return `xstate.done.state.${stateNodeId}`;
}

export function createDoneStateEvent<TOutput>(stateNodeId: string, output: TOutput): DoneStateEvent<TOutput> {
    return { type: createDoneStateEventType(stateNodeId), output };
}
