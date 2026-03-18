import { Machine } from './Machine';
import { MachineIdle } from './MachineIdle';
import { MachinePending } from './MachinePending';
import { MachineSuccess } from './MachineSuccess';
import { MachineError } from './MachineError';
import { MachineRefreshing } from './MachineRefreshing';

describe('Machine (static factory)', () => {
    // M14: Invalid transitions don't compile (type-level test)
    it('M14: MachineIdle does not have successHappened method', () => {
        const idle = MachineIdle.create();
        expectTypeOf(idle).not.toHaveProperty('successHappened');
        expectTypeOf(idle).not.toHaveProperty('errorHappened');
        expectTypeOf(idle).not.toHaveProperty('invalidate');
        expectTypeOf(idle).not.toHaveProperty('retry');
    });

    // M15: Machine.fromSnapshot restores MachineSuccess
    it('M15: fromSnapshot restores MachineSuccess', () => {
        const snapshot = {
            status: 'success' as const,
            data: { name: 'Alice' },
            args: 42,
            updatedAt: 123,
        };
        const machine = Machine.fromSnapshot<{ name: string }>(snapshot);

        expect(machine).toBeInstanceOf(MachineSuccess);
        expect(machine.state.status).toBe('success');
        expect((machine.state as { data: unknown }).data).toEqual({ name: 'Alice' });
    });

    // M16: Machine.fromSnapshot handles unknown status
    it('M16: fromSnapshot throws on unknown status', () => {
        expect(() => {
            Machine.fromSnapshot({ status: 'unknown' as never });
        }).toThrow('Unknown machine status');
    });

    it('idle() creates MachineIdle', () => {
        const idle = Machine.idle();
        expect(idle).toBeInstanceOf(MachineIdle);
        expect(idle.state.status).toBe('idle');
    });

    it('fromSnapshot restores all status types', () => {
        const idle = Machine.fromSnapshot({ status: 'idle' as const });
        expect(idle).toBeInstanceOf(MachineIdle);

        const pending = Machine.fromSnapshot({ status: 'pending' as const, args: { id: 1 } });
        expect(pending).toBeInstanceOf(MachinePending);

        const success = Machine.fromSnapshot({
            status: 'success' as const,
            data: 'hello',
            args: 1,
            updatedAt: 100,
        });
        expect(success).toBeInstanceOf(MachineSuccess);

        const error = Machine.fromSnapshot({
            status: 'error' as const,
            error: new Error('fail'),
            args: 1,
        });
        expect(error).toBeInstanceOf(MachineError);

        const refreshing = Machine.fromSnapshot({
            status: 'refreshing' as const,
            data: 'hello',
            args: 1,
            updatedAt: 100,
        });
        expect(refreshing).toBeInstanceOf(MachineRefreshing);
    });

    // M17: all machine .state properties produce JSON-serializable output
    it('M17: all machine states are JSON-serializable', () => {
        const machines = [
            MachineIdle.create(),
            MachinePending.create({ id: 1 }),
            MachineSuccess.create({ name: 'Alice' }, { id: 1 }),
            MachineError.create(new Error('fail'), { id: 1 }),
            MachineRefreshing.create({ name: 'Alice' }, { id: 1 }, 1000),
        ];

        for (const machine of machines) {
            const json = JSON.stringify(machine.state);
            expect(json).toBeTypeOf('string');
            const parsed = JSON.parse(json);
            expect(parsed.status).toBeTypeOf('string');
        }
    });
});
