import { SKIP } from "@/query-v2/lib/SKIP_TOKEN";

describe("SKIP_TOKEN", () => {
    it("L01: SKIP is a unique symbol", () => {
        expect(typeof SKIP).toBe("symbol");
    });

    it("SKIP is unique — not equal to another Symbol with same description", () => {
        const other = Symbol("SKIP");
        expect(SKIP).not.toBe(other);
    });

    it('SKIP has description "SKIP"', () => {
        expect(SKIP.description).toBe("SKIP");
    });
});
