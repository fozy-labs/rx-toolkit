import { applyPatches, enablePatches, produceWithPatches } from "immer";
import { ResourceDefinition, ResourceRefInstanse, ResourceTransaction } from "@/query/types";
import { CoreResourceQueryCache, Resource } from "./Resource";

enablePatches();

export class ResourceRef<D extends ResourceDefinition> implements ResourceRefInstanse<D> {
    private _cacheItem: CoreResourceQueryCache<D> | null = null;

    constructor(
        private readonly _resource: Resource<D>,
        private readonly _args: D["Args"]
    ) {
    }

    get has() {
        if (this._cacheItem) return true;
        this._cacheItem = this._resource.getQueryCache(this._args) ?? null;
        return !!this._cacheItem;
    }

    lock() {
        this._cacheItem = this._resource.incrementLock(this._args, { cache: this._cacheItem ?? undefined });
        let isLocked = true;

        return {
            unlock: () => {
                if (!isLocked) return
                isLocked = false;
                this._resource.decrementLock(this._args, { cache: this._cacheItem! });
            }
        }
    }

    unlockOne() {
        this._cacheItem = this._resource.decrementLock(this._args, { cache: this._cacheItem! });
    }

    patch(patchFn: (data: D["Data"]) => void): ResourceTransaction | null {
        let isSkipped = true;

        const reapplyFn = (
            data: D["Data"],
            savedData: D["Data"] | null,
            transactions: ResourceTransaction[] | null
        ) => {
            if (!transactions || transactions.length === 0) {
                return { data, transactions, savedData }
            }

            // Все валидные committed - пропускаем и убираем из очереди
            // Все aborted - применяем и убираем из очереди
            // Все pending - применяем и оставляем в очереди
            // Все commited (которые после pending) - применяем, но оставляем в очереди
            // Все aborted (которые после pending) - откатываем, но оставляем в очереди
            // Если после aborted нет pending - пропускаем и убираем из очереди
            // Те после применения всех транзакций, очередь должна начинаться с первой pending транзакции (если есть), включая все, что после неё.
            let newSavedData = savedData ?? data;
            let currentData = savedData ?? data;
            const remainingTransactions: ResourceTransaction[] = [];
            let foundPending = false;

            const lastPendingIndex = transactions.findLastIndex(t => t.status === 'pending');

            transactions.forEach((transaction, index) => {
                if (transaction.status === 'pending') {
                    foundPending = true;
                    // Применяем pending транзакцию и оставляем в очереди
                    currentData = applyPatches(currentData, transaction.patches);
                    remainingTransactions.push(transaction);
                } else if (foundPending) {
                    // После pending транзакции
                    if (transaction.status === 'committed') {
                        // Применяем и оставляем в очереди
                        currentData = applyPatches(currentData, transaction.patches);
                        remainingTransactions.push(transaction);
                    } else if (transaction.status === 'aborted') {
                        // Проверяем, есть ли pending после текущей aborted
                        const hasPendingAfter = index < lastPendingIndex;

                        if (hasPendingAfter) {
                            currentData = applyPatches(currentData, transaction.inversePatches);
                            remainingTransactions.push(transaction);
                        }
                        // Если pending нет - пропускаем и убираем из очереди
                    }
                } else {
                    // До первой pending транзакции
                    if (transaction.status === 'committed') {
                        // Применяем и убираем из очереди
                        const patches = transaction.patches;
                        currentData = applyPatches(currentData, patches);
                        newSavedData = currentData;
                    }
                }
            });

            const hasTransactions = remainingTransactions.length > 0;

            return {
                data: currentData,
                transactions: hasTransactions ? remainingTransactions : null,
                savedData: hasTransactions ? newSavedData : null,
            };
        }

        const reapplyTransactions = () => {
            this._resource.update(
                this._args,
                reapplyFn,
                { cache: this._cacheItem ?? undefined }
            );
        }

        const transaction: ResourceTransaction = {
            patches: [],
            inversePatches: [],
            status: 'pending',
            abort() {
                if (this.status !== 'pending') return;
                this.status = 'aborted';
                reapplyTransactions();
            },
            commit() {
                if (this.status !== 'pending') return;
                this.status = 'committed';
                reapplyTransactions();
            }
        };

        const updateFn = (
            data: D["Data"],
            savedData: D["Data"] | null,
            transactions: ResourceTransaction[] | null
        ) => {
            isSkipped = false;

            const [newData, patches, inversePatches] = produceWithPatches<D["Data"]>(
                data,
                (draft) => patchFn(draft)
            );

            transaction.patches = patches;
            transaction.inversePatches = inversePatches;

            const newTransactions = [...(transactions ?? [])];
            newTransactions.push(transaction);

            return {
                data: newData,
                transactions: newTransactions,
                savedData: savedData ?? data,
            }
        };

        this._cacheItem = this._resource.update(
            this._args,
            updateFn,
            { cache: this._cacheItem ?? undefined }
        );

        if (isSkipped) {
            return null;
        }

        return transaction;
    }

    create(data: D["Data"]): void {
        throw new Error("Method not implemented.");
    }

    invalidate(): void {
        throw new Error("Method not implemented.");
    }
}
