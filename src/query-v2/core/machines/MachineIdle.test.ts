import { describe, it, expect } from 'vitest';
import { MachineIdle } from './MachineIdle';
import { MachinePending } from './MachinePending';

describe('MachineIdle', () => {
    // M1: MachineIdle → MachinePending via start(args)
    it('M1: start(args) transitions to MachinePending', () => {
        const idle = MachineIdle.create();
        const pending = idle.start({ id: 1 });

        expect(pending).toBeInstanceOf(MachinePending);
        expect(pending.state.status).toBe('pending');
        expect(pending.state.args).toEqual({ id: 1 });
    });

    // M13: MachineIdle.reset() returns same idle instance (identity)
    it('M13: reset() returns same instance (identity)', () => {
        const idle = MachineIdle.create();
        const reset = idle.reset();

        expect(reset).toBe(idle);
        expect(reset.state.status).toBe('idle');
    });

    it('create() produces correct idle state', () => {
        const idle = MachineIdle.create();
        expect(idle.state).toEqual({
            status: 'idle',
            args: null,
            data: null,
            error: null,
            updatedAt: null,
        });
    });
});
