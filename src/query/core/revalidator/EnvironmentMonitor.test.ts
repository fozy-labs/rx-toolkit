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

    it("retries the connection after the driver throws", () => {
        const state = { visible: true, focused: true, online: true };
        const error = new Error("connect failed");
        let attempts = 0;
        const connect = vi.fn((_onChange: (state: TEnvironmentState) => void) => {
            attempts += 1;
            if (attempts === 1) throw error;
            return state;
        });
        const driver: IEnvironmentDriver = { connect, disconnect: vi.fn() };
        const monitor = new EnvironmentMonitor(driver);

        expect(() => monitor.state).toThrow(error);
        expect(monitor.state).toEqual(state);
        expect(connect).toHaveBeenCalledTimes(2);
    });

    it("ignores synchronous connect callbacks and deduplicates identical states", () => {
        const events: unknown[] = [];
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

        monitor.subscribe((event) => events.push(event));
        expect(events).toEqual([]);

        reports[0]?.({
            visible: true,
            focused: true,
            online: true,
        });
        expect(events).toEqual([]);
    });

    it("emits one event per changed report with availability and away durations", () => {
        vi.setSystemTime(100);
        const source = createDriver({ visible: true, focused: false, online: false });
        const monitor = new EnvironmentMonitor(source.driver);
        const events: unknown[] = [];
        monitor.subscribe((event) => events.push(event));

        vi.setSystemTime(175);
        source.report({ visible: false, focused: true, online: true });

        expect(events).toEqual([{ availabilityChanged: true, focusAwayMs: 75, reconnectAwayMs: 75 }]);
        expect(monitor.state).toEqual({ visible: false, focused: true, online: true });
        source.report({ visible: false, focused: true, online: true });
        expect(events).toHaveLength(1);
    });

    it("deduplicates full state reports and isolates throwing listeners", () => {
        const source = createDriver({ visible: true, focused: false, online: true });
        const monitor = new EnvironmentMonitor(source.driver);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const events: unknown[] = [];
        monitor.subscribe(() => {
            throw new Error("listener failed");
        });
        monitor.subscribe((event) => events.push(event));

        source.report({ visible: true, focused: false, online: true });
        source.report({ visible: true, focused: true, online: true });
        source.report({ visible: true, focused: true, online: true });

        expect(events).toEqual([{ availabilityChanged: false, focusAwayMs: 0, reconnectAwayMs: null }]);
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
