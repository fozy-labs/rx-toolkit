import { CleanAllResourcesSignal } from "../core/CleanAllResourcesSignal";

export function cleanAllResources() {
    CleanAllResourcesSignal.clean();
}
