import { describe, it, expect, vi } from 'vitest';
import { DependencyTracker, DependencyRecord } from './DependencyTracker';
import { EMPTY } from 'rxjs';

function makeDep(label: string): DependencyRecord {
    return {
        getRang: () => 0,
        obs: EMPTY,
        peek: () => label,
        meta: label,
    };
}

describe('DependencyTracker', () => {
    it('start(handler) → track(dep) → stop(): dependency tracked', () => {
        const tracked: DependencyRecord[] = [];
        const stop = DependencyTracker.start((dep) => tracked.push(dep));

        const dep = makeDep('a');
        DependencyTracker.track(dep);
        stop();

        expect(tracked).toEqual([dep]);
    });

    it('tracks multiple dependencies', () => {
        const tracked: DependencyRecord[] = [];
        const stop = DependencyTracker.start((dep) => tracked.push(dep));

        const d1 = makeDep('x');
        const d2 = makeDep('y');
        const d3 = makeDep('z');
        DependencyTracker.track(d1);
        DependencyTracker.track(d2);
        DependencyTracker.track(d3);
        stop();

        expect(tracked).toHaveLength(3);
        expect(tracked).toEqual([d1, d2, d3]);
    });

    it('nested tracked contexts — inner does not clobber outer', () => {
        const outerTracked: DependencyRecord[] = [];
        const innerTracked: DependencyRecord[] = [];

        const stopOuter = DependencyTracker.start((dep) => outerTracked.push(dep));

        const outerDep = makeDep('outer');
        DependencyTracker.track(outerDep);

        const stopInner = DependencyTracker.start((dep) => innerTracked.push(dep));
        const innerDep = makeDep('inner');
        DependencyTracker.track(innerDep);
        stopInner();

        // After inner stops, outer handler is restored
        const outerDep2 = makeDep('outer2');
        DependencyTracker.track(outerDep2);
        stopOuter();

        expect(innerTracked).toEqual([innerDep]);
        expect(outerTracked).toEqual([outerDep, outerDep2]);
    });

    it('stop() restores previous handler', () => {
        const handler1 = vi.fn();
        const handler2 = vi.fn();

        const stop1 = DependencyTracker.start(handler1);
        const stop2 = DependencyTracker.start(handler2);

        DependencyTracker.track(makeDep('a'));
        expect(handler2).toHaveBeenCalledOnce();
        expect(handler1).not.toHaveBeenCalled();

        stop2();

        DependencyTracker.track(makeDep('b'));
        expect(handler1).toHaveBeenCalledOnce();

        stop1();
    });

    it('track() without start() does nothing (no handler)', () => {
        // No handler set — should not throw
        expect(() => DependencyTracker.track(makeDep('orphan'))).not.toThrow();
    });
});
