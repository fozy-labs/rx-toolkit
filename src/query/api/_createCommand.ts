import { Command } from "@/query/core/command";
import type { ICommand, TCommandOptions } from "@/query/types";

export function _createCommand<TArgs = void, TResult = unknown>(
    options: TCommandOptions<TArgs, TResult>,
): ICommand<TArgs, TResult> {
    return new Command<TArgs, TResult>(options);
}
