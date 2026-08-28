/** The full definition of an event, with a string `type`. */
export interface EventObject {
    /** The type of event that is sent. */
    type: string;
}

/**
 * Default `TEvent` of `createMachine` when `types.events` is not given. Extra
 * properties read as `unknown` (no `any` leak); declare `types.events` for
 * narrowed events.
 */
export interface AnyEventObject extends EventObject {
    [key: string]: unknown;
}

/**
 * `{ type: "xstate.init", input: undefined }` — the event of the initial
 * macrostep. Like XState's, it always carries an `input` key; actor `input`
 * is not supported, so the value is always `undefined`.
 */
export interface InitEvent extends EventObject {
    type: "xstate.init";
    input: undefined;
}

/** `{ type: "xstate.stop" }` — processed by `Statechart.stop()`. */
export interface StopEvent extends EventObject {
    type: "xstate.stop";
}

/**
 * `xstate.done.state.<stateNodeId>` — raised internally when a compound state
 * enters a final child, or when every region of a parallel state is final.
 * `output` is the resolved `output` of the final child (compound parents only).
 */
export interface DoneStateEvent<TOutput = unknown> extends EventObject {
    type: `xstate.done.state.${string}`;
    output: TOutput;
}

/** `xstate.after.<delay>.<stateNodeId>` — delivered by the clock for `after` transitions. */
export interface AfterEvent extends EventObject {
    type: `xstate.after.${string}`;
}

/** Events the runtime produces on its own (never sent by user code). */
export type SystemEvent = InitEvent | StopEvent | DoneStateEvent | AfterEvent;

/** Anything the interpreter may process: user events plus system events. */
export type MachineEvent<TEvent extends EventObject> = TEvent | SystemEvent;

type PartialEventDescriptor<TEventType extends string> = TEventType extends `${infer TLeading}.${infer TTail}`
    ? `${TLeading}.*` | `${TLeading}.${PartialEventDescriptor<TTail>}`
    : never;

/**
 * Keys accepted by `on`: an exact event type, a partial wildcard (`"foo.*"`)
 * or the catch-all `"*"`. Mirrors XState's `EventDescriptor`.
 */
export type EventDescriptor<TEvent extends EventObject> = TEvent["type"] | PartialEventDescriptor<TEvent["type"]> | "*";

type NormalizeDescriptor<TDescriptor extends string> = TDescriptor extends "*"
    ? string
    : TDescriptor extends `${infer TLeading}.*`
      ? `${TLeading}.${string}`
      : TDescriptor;

/**
 * The member(s) of the `TEvent` union matched by a descriptor. Used to type
 * `event` inside transition actions/guards. Mirrors XState's `ExtractEvent`.
 */
export type ExtractEvent<
    TEvent extends EventObject,
    TDescriptor extends EventDescriptor<TEvent>,
> = string extends TEvent["type"]
    ? TEvent
    : NormalizeDescriptor<TDescriptor> extends infer TNormalized
      ? TEvent extends any
          ? TEvent["type"] extends TNormalized
              ? TEvent
              : never
          : never
      : never;
