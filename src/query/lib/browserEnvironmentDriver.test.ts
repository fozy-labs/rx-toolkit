// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { browserEnvironmentDriver } from "./browserEnvironmentDriver";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

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

    it("guards document listeners when only window is available", () => {
        vi.stubGlobal("document", undefined);
        const addEventListener = vi.spyOn(window, "addEventListener");
        const removeEventListener = vi.spyOn(window, "removeEventListener");
        const driver = browserEnvironmentDriver();
        const onChange = vi.fn();

        const initial = driver.connect(onChange);
        expect(initial).toEqual({
            visible: false,
            focused: false,
            online: typeof navigator === "undefined" || navigator.onLine !== false,
        });
        expect(onChange).not.toHaveBeenCalled();
        expect(addEventListener.mock.calls.map(([type]) => type)).toEqual(["focus", "blur", "online", "offline"]);

        expect(() => driver.disconnect()).not.toThrow();
        expect(removeEventListener.mock.calls.map(([type]) => type)).toEqual(["focus", "blur", "online", "offline"]);
    });
});
