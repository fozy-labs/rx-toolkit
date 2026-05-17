import { injectable } from '@fozy-labs/simplest-di';
import { LocalSignal } from '@fozy-labs/rx-toolkit';

export type Theme = 'light' | 'dark';

@injectable('SINGLETON')
export class ThemeStore {
    theme$ = LocalSignal.create<Theme>({
        key: 'showcase-theme',
        defaultValue: 'light',
        devtoolsOptions: { base: 'showcase/ui', key: 'theme' },
    });

    toggleTheme = () => {
        this.theme$.set(this.theme$.peek() === 'light' ? 'dark' : 'light');
    };
}
