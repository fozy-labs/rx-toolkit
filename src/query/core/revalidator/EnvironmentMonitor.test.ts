import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IEnvironmentDriver, TEnvironmentState } from "@/query/types";

import { EnvironmentMonitor } from "./EnvironmentMonitor";

function createDriver(initial: TEnvironmentState) {
    let report: ((state: TEnvironmentState) => void) | null = null;
    const driver: IEnvironmentDriver = {
        connect: vi.fn((onChange) => {
            report = onChange;
            return initial;
        }),
        disconnect: vi.fn(),
    };

    return {
        driver,
        report(state: TEnvironmentState) {
            report?.(state);
        },
    };
}

describe("EnvironmentMonitor", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("connects lazily on the first subscription or state read", () => {
        const { driver } = createDriver({ visible: true, focused: true, online: true });
        const monitor = new EnvironmentMonitor(driver);

        expect(driver.connect).not.toHaveBeenCalled();
        const unsubscribe = monitor.subscribe(() => {});
        expect(driver.connect).toHaveBeenCalledTimes(1);
        expect(monitor.state).toEqual({ visible: true, focused: true, online: true });

        unsubscribe();
        expect(driver.disconnect).not.toHaveBeenCalled();
    });

    it("ignores synchronous connect callbacks and deduplicates identical states", () => {
        const events: string[] = [];
        const reports: Array<(state: TEnvironmentState) => void> = [];
        const driver: IEnvironmentDriver = {
            connect: vi.fn((onChange) => {
                reports.push(onChange);
                onChange({ visible: false, focused: false, online: true });
                return { visible: true, focused: true, online: true };
            }),
            disconnect: vi.fn(),
        };
        const monitor = new EnvironmentMonitor(driver);

        monitor.subscribe(({ type }) => events.push(type));
        expect(events).toEqual([]);

        reports[0]?.({
            visible: true,
            focused: true,
            online: true,
        });
        expect(events).toEqual([]);
    });

    it("emits change, focus and reconnect in order with away durations", () => {
        vi.setSystemTime(100);
        const source = createDriver({ visible: true, focused: false, online: false });
        const monitor = new EnvironmentMonitor(source.driver);
        const events: unknown[] = [];
        monitor.subscribe((event) => events.push(event));

        vi.setSystemTime(175);
        source.report({ visible: false, focused: true, online: true });

        expect(events).toEqual([{ type: "change" }, { type: "focus", awayMs: 75 }, { type: "reconnect", awayMs: 75 }]);
        expect(monitor.state).toEqual({ visible: false, focused: true, online: true });
    });

    it("deduplicates full state reports and isolates throwing listeners", () => {
        const source = createDriver({ visible: true, focused: false, online: true });
        const monitor = new EnvironmentMonitor(source.driver);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const events: string[] = [];
        monitor.subscribe(() => {
            throw new Error("listener failed");
        });
        monitor.subscribe(({ type }) => events.push(type));

        source.report({ visible: true, focused: false, online: true });
        source.report({ visible: true, focused: true, online: true });
        source.report({ visible: true, focused: true, online: true });

        expect(events).toEqual(["focus"]);
        expect(error).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledWith("[EnvironmentMonitor] listener threw", expect.any(Error));
    });

    it("uses constant availability and emits no events for a null driver", () => {
        const monitor = new EnvironmentMonitor(null);
        const listener = vi.fn();

        monitor.subscribe(listener);
        expect(monitor.state).toEqual({ visible: true, focused: true, online: true });
        expect(listener).not.toHaveBeenCalled();
    });
});
