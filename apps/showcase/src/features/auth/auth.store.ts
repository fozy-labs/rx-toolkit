import { injectable } from '@fozy-labs/simplest-di';
import { LocalSignal, Signal } from '@fozy-labs/rx-toolkit';
import type { User } from '@/entities/user';
import { findUserByEmail } from './auth.utils';

@injectable('SINGLETON')
export class AuthStore {
    currentUser$ = LocalSignal.create<User | null>({
        key: 'showcase-current-user',
        defaultValue: null,
        devtoolsOptions: { base: 'showcase/auth', key: 'currentUser' },
    });

    isAuthenticated$ = Signal.compute(() => this.currentUser$() !== null, {
        base: 'showcase/auth',
        key: 'isAuthenticated',
    });

    login(email: string): { ok: boolean; error?: string } {
        const user = findUserByEmail(email);

        if (!user) {
            return { ok: false, error: 'User not found. Try: sincere@april.biz' };
        }

        this.currentUser$.set(user);
        return { ok: true };
    }

    logout = () => this.currentUser$.clear();
}
