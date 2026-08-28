import { parallelFixture } from "./parallel";
import { squareFixture } from "./square";
import { trafficLightFixture } from "./trafficLight";
import type { VizFixture } from "./types";

export * from "./parallel";
export * from "./square";
export * from "./trafficLight";
export * from "./types";

/** All fixtures by name (context type erased), for the playground page and the e2e tests. */
export const fixtures: Record<string, VizFixture<unknown>> = {
    trafficLight: trafficLightFixture as VizFixture<unknown>,
    square: squareFixture as VizFixture<unknown>,
    parallel: parallelFixture as VizFixture<unknown>,
};
