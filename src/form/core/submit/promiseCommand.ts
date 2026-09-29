import { DEFAULT_COMMAND_RETENTION_TIME } from "@/query/core/api/constants";
import { Command } from "@/query/core/command/Command";
import type { ICommand } from "@/query/types";

import type { GroupRecord } from "../definition/records";

/**
 * The command a promise `submit` runs as, so it gets the same `submission$` rows as a bound
 * command. One per definition: its entries are keyed by the instances' entry keys. A form defined
 * through `api.defineForm` creates it on that api, so the rejection passes the api's `mapError`
 * and `resetAll()` reaches the entry; a primitive form creates it standalone.
 */
export interface PromiseCommand {
    readonly command: ICommand<void, unknown, unknown>;
    /**
     * Hands the attempt's promise to the next run. `trigger()` runs `queryFn` synchronously, so
     * the promise is taken by the run it was handed to.
     */
    hand(promise: Promise<unknown>): void;
}

const commands = new WeakMap<GroupRecord, PromiseCommand>();

export function promiseCommandOf(record: GroupRecord): PromiseCommand {
    let result = commands.get(record);
    if (!result) {
        result = createPromiseCommand(record);
        commands.set(record, result);
    }
    return result;
}

function createPromiseCommand(record: GroupRecord): PromiseCommand {
    let handed: Promise<unknown> | null = null;
    const queryFn = (): Promise<unknown> => {
        const promise = handed;
        handed = null;
        // Only a retry could run without a promise, and a promise submit is never retried.
        return promise ?? Promise.reject(new Error("unstable_FormSignal: a promise submit cannot be retried"));
    };
    const command: ICommand<void, unknown, unknown> = record.api
        ? record.api.createCommand<void, unknown>({ queryFn })
        : new Command<void, unknown>({ queryFn, links: [], retentionTime: DEFAULT_COMMAND_RETENTION_TIME });
    return {
        command,
        hand: (promise) => {
            handed = promise;
        },
    };
}
