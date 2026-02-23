import type { CommandCreateFn, CommandCreateOptions, CommandDefinition } from "@/query/types";
import { Command } from "@/query/core/Command/Command";

/**
 * Создаёт команду (command) — единицу мутирующего запроса.
 *
 * Команда инкапсулирует асинхронную операцию с поддержкой кеширования,
 * связывания с ресурсами (link) и оптимистичных обновлений.
 *
 * @example
 * ```ts
 * const updateUser = createCommand({
 *   queryFn: (args: { id: string; name: string }) => api.updateUser(args),
 *   link: (link) => link({
 *     resource: userResource,
 *     forwardArgs: (args) => ({ id: args.id }),
 *     invalidate: true,
 *   }),
 * });
 * ```
 */
export const createCommand = (
    <ARGS, RESULT, SELECTED = never>(
        options: CommandCreateOptions<CommandDefinition<ARGS, RESULT, SELECTED>>
    ) => new Command(options)
) satisfies CommandCreateFn<any, any, any>;
