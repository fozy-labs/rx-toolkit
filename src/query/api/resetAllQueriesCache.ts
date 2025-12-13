import { ResetAllQueriesSignal } from "../core/ResetAllQueriesSignal";

export function resetAllQueriesCache() {
    ResetAllQueriesSignal.clean();
}
