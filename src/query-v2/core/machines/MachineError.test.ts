import { MachineError } from './MachineError';
import { MachinePending } from './MachinePending';
import { MachineIdle } from './MachineIdle';

describe('MachineError', () => {
    // M10: MachineError → MachinePending via retry()
    it('M10: retry() transitions to MachinePending with same args', () => {
        const error = MachineError.create(new Error('404'), { id: 1 });
        const pending = error.retry();

        expect(pending).toBeInstanceOf(MachinePending);
        expect(pending.state.status).toBe('pending');
        expect(pending.state.args).toEqual({ id: 1 });
    });

    // M11: MachineError → MachinePending via start(args)
    it('M11: start(newArgs) transitions to MachinePending with new args', () => {
        const error = MachineError.create(new Error('404'), { id: 1 });
        const pending = error.start({ id: 3 });

        expect(pending).toBeInstanceOf(MachinePending);
        expect(pending.state.status).toBe('pending');
        expect(pending.state.args).toEqual({ id: 3 });
    });

    // M12: MachineError → MachineIdle via reset()
    it('M12: reset() transitions to MachineIdle', () => {
        const error = MachineError.create(new Error('404'), { id: 1 });
        const idle = error.reset();

        expect(idle).toBeInstanceOf(MachineIdle);
        expect(idle.state.status).toBe('idle');
    });

    it('create() produces correct error state', () => {
        const err = new Error('Not found');
        const error = MachineError.create(err, { id: 1 });
        expect(error.state.status).toBe('error');
        expect(error.state.error).toBe(err);
        expect(error.state.args).toEqual({ id: 1 });
        expect(error.state.data).toBeNull();
        expect(error.state.updatedAt).toBeNull();
    });

    it('transitions return new instances (immutability)', () => {
        const error = MachineError.create(new Error('fail'), { id: 1 });
        const pending = error.retry();
        const idle = error.reset();

        // Original unchanged
        expect(error.state.status).toBe('error');
        expect(error.state.args).toEqual({ id: 1 });

        expect(pending).not.toBe(error);
        expect(idle).not.toBe(error);
    });
});
