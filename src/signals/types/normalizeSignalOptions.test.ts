import { describe, it, expect } from 'vitest';
import { normalizeSignalOptions } from './normalizeSignalOptions';

describe('normalizeSignalOptions', () => {
    it('строка → { key }', () => {
        expect(normalizeSignalOptions('counter')).toEqual({ key: 'counter' });
    });

    it('объект с key — возвращается как есть', () => {
        const opts = { key: 'x', base: 'State' };
        expect(normalizeSignalOptions(opts)).toEqual({ key: 'x', base: 'State' });
    });

    it('undefined → {}', () => {
        expect(normalizeSignalOptions(undefined)).toEqual({});
    });

    it('deprecated name → key', () => {
        expect(normalizeSignalOptions({ name: 'counter' })).toEqual({ name: 'counter', key: 'counter' });
    });

    it('name + key — key приоритетнее', () => {
        const opts = { name: 'old', key: 'new' };
        expect(normalizeSignalOptions(opts)).toEqual({ name: 'old', key: 'new' });
    });

    it('объект с hooks[] сохраняется', () => {
        const onInit = () => {};
        const opts = { key: 'x', hooks: [{ onInit }] };
        const result = normalizeSignalOptions(opts);
        expect(result.hooks).toEqual([{ onInit }]);
    });

    it('объект с beforeDevtoolsPush сохраняется', () => {
        const beforeDevtoolsPush = () => {};
        const opts = { beforeDevtoolsPush };
        const result = normalizeSignalOptions(opts);
        expect(result.beforeDevtoolsPush).toBe(beforeDevtoolsPush);
    });

    it('пустой объект → {}', () => {
        expect(normalizeSignalOptions({})).toEqual({});
    });
});
