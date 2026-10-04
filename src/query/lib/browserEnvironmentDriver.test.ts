// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { browserEnvironmentDriver } from "./browserEnvironmentDriver";

afterEach(() => vi.restoreAllMocks());

describe("browserEnvironmentDriver", () => {
    it("reads initial visibility, focus and connectivity", () => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        vi.spyOn(document, "hasFocus").mockReturnValue(true);
        Object.defineProperty(navigator, "onLine", { configurable: true, value: true });

        const driver = browserEnvironmentDriver();
        const onChange = vi.fn();

        expect(driver.connect(onChange)).toEqual({ visible: true, focused: true, online: true });
        driver.disconnect();
    });

    it("reports full state on visibility, focus and connectivity events and disconnects them", () => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
        Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
        const driver = browserEnvironmentDriver();
        const onChange = vi.fn();
        driver.connect(onChange);

        hasFocus.mockReturnValue(false);
        window.dispatchEvent(new Event("blur"));
        expect(onChange).toHaveBeenLastCalledWith({ visible: true, focused: false, online: true });

        hasFocus.mockReturnValue(true);
        window.dispatchEvent(new Event("focus"));
        expect(onChange).toHaveBeenLastCalledWith({ visible: true, focused: true, online: true });

        Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
        window.dispatchEvent(new Event("offline"));
        expect(onChange).toHaveBeenLastCalledWith({ visible: true, focused: true, online: false });

        Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
        window.dispatchEvent(new Event("online"));
        expect(onChange).toHaveBeenLastCalledWith({ visible: true, focused: true, online: true });

        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(onChange).toHaveBeenLastCalledWith({ visible: false, focused: false, online: true });

        driver.disconnect();
        const calls = onChange.mock.calls.length;
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
        expect(onChange).toHaveBeenCalledTimes(calls);
    });
});
