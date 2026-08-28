import type { MachineConfigJson } from "@fozy-labs/statechart-converter";

import type { VizEvent } from "../../types";

/** Event as seen by fixture guards/actions: the type plus an arbitrary payload. */
export type FixtureEvent = VizEvent & Record<string, unknown>;

export type FixtureGuard<TContext> = (args: { context: TContext; event: FixtureEvent }) => boolean;

/**
 * Returns the next context (an immutable update) or `undefined` to leave the
 * context unchanged.
 */
export type FixtureAction<TContext> = (args: { context: TContext; event: FixtureEvent }) => TContext | void;

/**
 * A hand-written machine for the playground and the tests: verbatim `.mmd`
 * text, its config in the converter's JSON shape and the implementations the
 * test double needs.
 */
export type VizFixture<TContext = unknown> = {
    name: string;
    source: string;
    config: MachineConfigJson;
    context: TContext;
    guards?: Record<string, FixtureGuard<TContext>>;
    actions?: Record<string, FixtureAction<TContext>>;
};
