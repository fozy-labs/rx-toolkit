const Scheduled = {
    map: new Map<number, Set<() => void>>(),
    lowestRang: -1,
    isLocked: false,
    // The first error of the batch (from fn or a task). The tasks after it
    // still run: the state write has already happened, and skipping the
    // remaining reactions would leave the graph out of sync with it.
    hasError: false,
    error: undefined as unknown,
    set(rang: number, fn: () => void) {
        if (rang < this.lowestRang) this.lowestRang = rang;
        if (!this.map.has(rang)) {
            this.map.set(rang, new Set());
        }
        this.map.get(rang)!.add(fn);
    },
    done() {
        this.lowestRang = -1;
        this.map.clear();
        this.hasError = false;
        this.error = undefined;
    },
    fail(error: unknown) {
        if (this.hasError) return;
        this.hasError = true;
        this.error = error;
    },
    exec(fns: Set<() => void>) {
        for (const fn of fns) {
            try {
                fn();
            } catch (error) {
                this.fail(error);
            }
        }
    },
    run() {
        // Итеративный флаш: ранги обрабатываются по возрастанию. Цикл вместо
        // рекурсии — глубина «лестницы» рангов равна глубине графа зависимостей
        // (rang = глубина + 1), и на глубоком графе рекурсия переполняла стек.
        while (true) {
            if (this.map.size === 0) return;
            // Infinity — терминальный ранг: выполняется, только когда finite
            // задач не осталось. Задача могла во время флаша (например,
            // devtools-флаш, дёрнувший State.set) запланировать новую работу —
            // поэтому после выполнения возвращаемся в начало цикла для
            // перепроверки очереди, а не завершаемся.
            if (this.map.size === 1 && this.map.has(Infinity)) {
                const fns = this.map.get(Infinity)!;
                this.map.delete(Infinity);
                this.exec(fns);
                continue;
            }
            const iterationRang = this.lowestRang;
            this.lowestRang += 1;
            const fns = this.map.get(iterationRang);
            this.map.delete(iterationRang);
            if (fns) this.exec(fns);
        }
    },
};

export const Batcher = {
    scheduler(rang: number) {
        return {
            schedule: (fn: () => void) => {
                if (!Scheduled.isLocked) return fn();
                Scheduled.set(rang, fn);
            },
        };
    },
    /**
     * Runs `fn` as one batch and flushes the work it scheduled. A throwing `fn`
     * or task does not stop the flush: every queued task still runs, and the
     * first error (`fn`'s, if it threw) is rethrown afterwards.
     */
    run<T>(fn: () => T): T {
        if (Scheduled.isLocked) return fn();
        Scheduled.isLocked = true;
        let result: T | undefined;
        try {
            try {
                result = fn();
            } catch (error) {
                Scheduled.fail(error);
            }
            Scheduled.run();
            if (Scheduled.hasError) throw Scheduled.error;
            return result as T;
        } finally {
            // Invariant: the transient batch state is fully reset on exit —
            // otherwise the queue, a stuck lowestRang or the error would leak
            // into the next, unrelated batch.
            Scheduled.done();
            Scheduled.isLocked = false;
        }
    },
};
