// A consumer of the devtools types: every export is left to inference, so its declaration
// names the types behind the reduxDevtools options and the stately inspection events.
// `declarations.test.ts` compiles it against the built package, with `@/index` replaced
// by the package name.
import { reduxDevtools, type StatelyInspectionEvent } from "@/index";

export const devtools = reduxDevtools({});

export type DevtoolsOptions = Parameters<typeof reduxDevtools>[0];

// Property access over the options expansion: the inferred type must name the extension
// interface, so it has to be inlinable — a named but unnameable shape breaks the emit (TS4058).
export function extensionOf(options: DevtoolsOptions) {
    return options?.driver;
}

export function actorOf(event: StatelyInspectionEvent) {
    return event.type === "@xstate.actor" ? event : null;
}
