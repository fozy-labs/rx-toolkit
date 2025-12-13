const Scheduled = {
    map: new Map<number, Set<() => void>>(),
    lowestRang: -1,
    isLocked: false,
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
    },
    handleInfinity() {
        const fns = this.map.get(Infinity);
        this.map.delete(Infinity);
        fns?.forEach((fn) => fn());
        this.done();
    },
    run() {
        if (this.map.size === 1 && this.map.has(Infinity)) return this.handleInfinity();
        if (this.map.size === 0) return this.done();
        const iterationRang = this.lowestRang;
        this.lowestRang += 1;
        const fns = this.map.get(iterationRang);
        this.map.delete(iterationRang);
        fns?.forEach((fn) => fn());
        this.run();
    },
}

export const Batcher = {
    scheduler(rang: number) {
        return {
            schedule: (fn: () => void) => {
                if (!Scheduled.isLocked) return fn();
                Scheduled.set(rang, fn);
            }
        }
    },
    run<T>(fn: () => T) {
        if (Scheduled.isLocked) return fn();
        Scheduled.isLocked = true;
        const v = fn();
        Scheduled.run();
        Scheduled.isLocked = false;
        return v;
    },
}
