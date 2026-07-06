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
    run() {
        // Итеративный флаш: ранги обрабатываются по возрастанию. Цикл вместо
        // рекурсии — глубина «лестницы» рангов равна глубине графа зависимостей
        // (rang = глубина + 1), и на глубоком графе рекурсия переполняла стек.
        while (true) {
            if (this.map.size === 0) return this.done();
            // Infinity — терминальный ранг: выполняется, только когда finite
            // задач не осталось. Задача могла во время флаша (например,
            // devtools-флаш, дёрнувший State.set) запланировать новую работу —
            // поэтому после выполнения возвращаемся в начало цикла для
            // перепроверки очереди, а не завершаемся.
            if (this.map.size === 1 && this.map.has(Infinity)) {
                const fns = this.map.get(Infinity)!;
                this.map.delete(Infinity);
                fns.forEach((fn) => fn());
                continue;
            }
            const iterationRang = this.lowestRang;
            this.lowestRang += 1;
            const fns = this.map.get(iterationRang);
            this.map.delete(iterationRang);
            fns?.forEach((fn) => fn());
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
    run<T>(fn: () => T) {
        if (Scheduled.isLocked) return fn();
        Scheduled.isLocked = true;
        try {
            const v = fn();
            Scheduled.run();
            return v;
        } finally {
            // Восстанавливаем инвариант «transient-состояние батча полностью
            // сброшено на выходе». На успехе Scheduled.run() уже вызвал done()
            // (идемпотентно), а при ошибке в fn() или во время флаша это
            // единственная уборка: иначе недовыполненные задачи и застрявший
            // lowestRang протекли бы в следующий несвязанный батч.
            Scheduled.done();
            Scheduled.isLocked = false;
        }
    },
};
