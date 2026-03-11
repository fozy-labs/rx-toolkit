import { SignalOptions, SignalOptionsOrKey } from './SignalOptions';

export function normalizeSignalOptions<T>(options?: SignalOptionsOrKey<T>): SignalOptions<T> {
    if (!options) return {};
    if (typeof options === 'string') return { key: options };
    if (options.name && !options.key) {
        return { ...options, key: options.name };
    }
    return options;
}
