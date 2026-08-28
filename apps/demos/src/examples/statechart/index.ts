import trafficLightRaw from "./traffic-light.tsx?raw";
import signupFormRaw from "./signup-form.tsx?raw";
import inspectorPlayerRaw from "./inspector-player.tsx?raw";
import squareVizRaw from "./square-viz.tsx?raw";
import squareMmdRaw from "./square.mmd?raw";

export { definition as square } from "./square.generated";

export const examples = {
    trafficLight: trafficLightRaw,
    signupForm: signupFormRaw,
    inspectorPlayer: inspectorPlayerRaw,
    squareViz: squareVizRaw,
};

/** Diagram sources shown next to the examples generated from them. */
export const sources = {
    squareMmd: squareMmdRaw,
};
