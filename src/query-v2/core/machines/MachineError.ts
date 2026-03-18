import type { TResourceV2ErrorState } from '@/query-v2/types/machine.types';
import { MachineIdle } from './MachineIdle';
import { MachinePending } from './MachinePending';

export class MachineError<TError = Error> {
    readonly state: TResourceV2ErrorState<TError>;

    private constructor(error: TError, args: unknown) {
        this.state = {
            status: 'error',
            args,
            data: null,
            error,
            updatedAt: null,
        };
    }

    retry(): MachinePending {
        return MachinePending.create(this.state.args);
    }

    start(args: unknown): MachinePending {
        return MachinePending.create(args);
    }

    reset(): MachineIdle {
        return MachineIdle.create();
    }

    static create<TError = Error>(error: TError, args: unknown): MachineError<TError> {
        return new MachineError<TError>(error, args);
    }
}
