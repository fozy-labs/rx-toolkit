import { Devtools } from '@reatom/devtools';

export class SharedOptions {
    static DEVTOOLS: Devtools | null = null
    static onError: ((error: unknown) => void) | null = null;
}
