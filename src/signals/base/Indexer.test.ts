import { Indexer } from './Indexer';

describe('Indexer', () => {
    it('getIndex() returns a number', () => {
        const index = Indexer.getIndex();
        expect(typeof index).toBe('number');
    });

    it('auto-increments on each call', () => {
        const first = Indexer.getIndex();
        const second = Indexer.getIndex();
        const third = Indexer.getIndex();

        expect(second).toBe(first + 1);
        expect(third).toBe(second + 1);
    });

    it('returns unique values across multiple calls', () => {
        const values = new Set<number>();
        for (let i = 0; i < 100; i++) {
            values.add(Indexer.getIndex());
        }
        expect(values.size).toBe(100);
    });
});
