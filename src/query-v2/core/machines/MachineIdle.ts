import type { TResourceV2IdleState } from '@/query-v2/types/machine.types';
import { MachinePending } from './MachinePending';

export class MachineIdle {
    readonly state: TResourceV2IdleState = {
        status: 'idle',
        args: null,
        data: null,
        error: null,
        updatedAt: null,
    };

    start(args: unknown): MachinePending {
        return MachinePending.create(args);
    }

    reset(): MachineIdle {
        return this;
    }

    static create(): MachineIdle {
        return new MachineIdle();
    }
}
