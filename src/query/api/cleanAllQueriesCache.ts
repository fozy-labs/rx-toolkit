import { CleanAllQueriesSignal } from "../core/CleanAllQueriesSignal";

export function cleanAllQueriesCache() {
    CleanAllQueriesSignal.clean();
}
