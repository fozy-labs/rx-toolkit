import type { ICommandV2, ICommandV2Agent, TCommandV2Options } from "@/query-v2/types";
import { Batcher } from "@/signals/base/Batcher";

import { CommandV2Agent } from "./CommandV2Agent";
import { CommandV2CacheEntry, type ICommandV2CacheEntryOptions } from "./CommandV2CacheEntry";

export class CommandV2<TArgs, TResult> implements ICommandV2<TArgs, TResult> {
    private _options: TCommandV2Options<TArgs, TResult>;
    private _entries = new Map<symbol, CommandV2CacheEntry<TArgs, TResult>>();

    readonly devtoolsName: string | undefined;

    constructor(options: TCommandV2Options<TArgs, TResult>) {
        this._options = options;
        this.devtoolsName = options.devtoolsName;
    }

    createAgent(): ICommandV2Agent<TArgs, TResult> {
        const key = Symbol();
        return new CommandV2Agent<TArgs, TResult>(this, key);
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

    _getOrCreateEntry(key: symbol): CommandV2CacheEntry<TArgs, TResult> {
        let entry = this._entries.get(key);
        if (entry) return entry;

        const entryOptions: ICommandV2CacheEntryOptions<TArgs, TResult> = {
            queryFn: this._options.queryFn,
            link: this._options.link,
            onCacheEntryAdded: this._options.onCacheEntryAdded,
            onQueryStarted: this._options.onQueryStarted,
            cacheLifetime: this._options.cacheLifetime,
        };
        entry = new CommandV2CacheEntry<TArgs, TResult>(entryOptions);
        this._entries.set(key, entry);
        return entry;
    }
}
