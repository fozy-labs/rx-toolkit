import type { ICommand, ICommandAgent, TCommandOptions } from "@/query/types";
import { Batcher } from "@/signals/base/Batcher";

import { CommandAgent } from "./CommandAgent";
import { CommandCacheEntry, type ICommandCacheEntryOptions } from "./CommandCacheEntry";

export class Command<TArgs, TResult> implements ICommand<TArgs, TResult> {
    private _options: TCommandOptions<TArgs, TResult>;
    private _entries = new Map<symbol, CommandCacheEntry<TArgs, TResult>>();

    readonly devtoolsName: string | undefined;

    constructor(options: TCommandOptions<TArgs, TResult>) {
        this._options = options;
        this.devtoolsName = options.devtoolsName;
    }

    createAgent(): ICommandAgent<TArgs, TResult> {
        return new CommandAgent<TArgs, TResult>({

        });
    }

    resetCache(): void {
        Batcher.run(() => {
            const entries = [...this._entries.values()];
            this._entries.clear();
            for (const entry of entries) {
                entry.complete();
            }
        });
    }

    _getOrCreateEntry(key: symbol): CommandCacheEntry<TArgs, TResult> {
        let entry = this._entries.get(key);
        if (entry) return entry;

        const entryOptions: ICommandCacheEntryOptions<TArgs, TResult> = {
            queryFn: this._options.queryFn,
            link: this._options.link,
            onCacheEntryAdded: this._options.onCacheEntryAdded,
            onQueryStarted: this._options.onQueryStarted,
            cacheLifetime: this._options.cacheLifetime,
        };
        entry = new CommandCacheEntry<TArgs, TResult>(entryOptions);
        this._entries.set(key, entry);
        return entry;
    }
}
