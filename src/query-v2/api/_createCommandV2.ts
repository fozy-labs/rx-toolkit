import { CommandV2 } from "@/query-v2/core/command";
import type { ICommandV2, TCommandV2Options } from "@/query-v2/types";

export function _createCommandV2<TArgs = void, TResult = unknown>(
    options: TCommandV2Options<TArgs, TResult>,
): ICommandV2<TArgs, TResult> {
    return new CommandV2<TArgs, TResult>(options);
}
