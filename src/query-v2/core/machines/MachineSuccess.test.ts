import { MachineSuccess } from './MachineSuccess';
import { MachineRefreshing } from './MachineRefreshing';
import { MachinePending } from './MachinePending';
import { MachineIdle } from './MachineIdle';
import { NO_VALUE } from '@/query-v2/lib/NO_VALUE';

describe('MachineSuccess', () => {
    // M4: MachineSuccess → MachineRefreshing via invalidate()
    it('M4: invalidate() transitions to MachineRefreshing', () => {
        const success = MachineSuccess.create({ name: 'Alice' }, { id: 1 });
        const refreshing = success.invalidate();

        expect(refreshing).toBeInstanceOf(MachineRefreshing);
        expect(refreshing.state.status).toBe('refreshing');
        expect(refreshing.state.data).toEqual({ name: 'Alice' });
        expect(refreshing.state.args).toEqual({ id: 1 });
    });

    // M5: MachineSuccess → MachinePending via start(newArgs)
    // Resolved per Task 2.2: Option A — start() method added
    it('M5: start(newArgs) transitions to MachinePending', () => {
        const success = MachineSuccess.create({ name: 'Alice' }, { id: 1 });
        const pending = success.start({ id: 2 });

        expect(pending).toBeInstanceOf(MachinePending);
        expect(pending.state.status).toBe('pending');
        expect(pending.state.args).toEqual({ id: 2 });
    });

    // M6: MachineSuccess → MachineIdle via reset()
    it('M6: reset() transitions to MachineIdle', () => {
        const success = MachineSuccess.create({ name: 'Alice' }, { id: 1 });
        const idle = success.reset();

        expect(idle).toBeInstanceOf(MachineIdle);
        expect(idle.state.status).toBe('idle');
        expect(idle.state.args).toBeNull();
        expect(idle.state.data).toBeNull();
    });

    it('create() produces correct success state', () => {
        const success = MachineSuccess.create({ name: 'Alice' }, { id: 1 });
        expect(success.state.status).toBe('success');
        expect(success.state.data).toEqual({ name: 'Alice' });
        expect(success.state.args).toEqual({ id: 1 });
        expect(success.state.error).toBeNull();
        expect(success.state.updatedAt).toBeTypeOf('number');
        expect(success.state.originalData).toBe(NO_VALUE);
        expect(success.state.patches).toBeNull();
    });

    // M17: machine.state is JSON-serializable
    it('M17: state is JSON-serializable', () => {
        const success = MachineSuccess.create({ name: 'Alice' }, { id: 1 });
        const json = JSON.stringify(success.state);
        expect(json).toBeTypeOf('string');

        const parsed = JSON.parse(json);
        expect(parsed.status).toBe('success');
        expect(parsed.data).toEqual({ name: 'Alice' });
    });

    it('deploy() restores from snapshot slice', () => {
        const slice = {
            status: 'success' as const,
            args: { id: 1 },
            data: { name: 'Alice' },
            updatedAt: 12345,
        };
        const success = MachineSuccess.deploy(slice);

        expect(success).toBeInstanceOf(MachineSuccess);
        expect(success.state.status).toBe('success');
        expect(success.state.data).toEqual({ name: 'Alice' });
        expect(success.state.args).toEqual({ id: 1 });
        expect(success.state.updatedAt).toBe(12345);
    });

    it('transitions return new instances (immutability)', () => {
        const success = MachineSuccess.create({ name: 'Alice' }, { id: 1 });
        const refreshing = success.invalidate();
        const pending = success.start({ id: 2 });
        const idle = success.reset();

        // Original unchanged
        expect(success.state.status).toBe('success');
        expect(success.state.data).toEqual({ name: 'Alice' });

        // All returns are different instances
        expect(refreshing).not.toBe(success);
        expect(pending).not.toBe(success);
        expect(idle).not.toBe(success);
    });
});
