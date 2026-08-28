import { expect, test, type Page } from "@playwright/test";

import { squareFixture } from "../src/testing/fixtures/square";

type PlaygroundWindow = Window & {
    __scvPlayground?: { machine: { send(event: { type: string }): void } | null };
};

async function open(page: Page, fixture: string, mode?: "source") {
    await page.goto(`/?fixture=${fixture}${mode ? `&mode=${mode}` : ""}`);
    await expect(page.locator('[data-scv-diagram="ready"]')).toBeVisible();
    await expect(page.locator("[data-scv-diagram] svg")).toBeVisible();
}

function activeStates(page: Page): Promise<string[]> {
    return page
        .locator("[data-scv-state].scv-active")
        .evaluateAll((elements) => elements.map((e) => e.getAttribute("data-scv-state") ?? "").sort());
}

function send(page: Page, event: { type: string }) {
    return page.evaluate((ev) => (window as PlaygroundWindow).__scvPlayground?.machine?.send(ev), event);
}

const edgeLabel = (page: Page, event: string) => page.locator(`g.edgeLabel[data-scv-event="${event}"]`);
const edgePath = (page: Page, event: string) => page.locator(`path.transition[data-scv-event="${event}"]`);
const logEntries = (page: Page) => page.locator("[data-scv-log] li");
const eventButton = (page: Page, event: string) => page.locator(`[data-scv-events] button[data-scv-event="${event}"]`);

test.describe("highlighting follows value", () => {
    test("compound states: parent and child are active together", async ({ page }) => {
        await open(page, "trafficLight");
        expect(await activeStates(page)).toEqual(["off"]);
        await expect(page.locator("[data-scv-value]")).toHaveText("off");

        await send(page, { type: "POWER_ON" });
        await expect.poll(() => activeStates(page)).toEqual(["green", "working"]);
        await expect(page.locator("[data-scv-value]")).toHaveText("working.green");

        await send(page, { type: "POWER_OFF" });
        await expect.poll(() => activeStates(page)).toEqual(["off"]);
    });

    test("spontaneous (timer) transitions are reflected without user input", async ({ page }) => {
        await open(page, "trafficLight");
        await send(page, { type: "POWER_ON" });
        await expect.poll(() => activeStates(page)).toEqual(["green", "working"]);
        // green → yellow after 3 s → red after 1 s; red is the first window long enough to sample reliably.
        await expect.poll(() => activeStates(page), { timeout: 10_000, intervals: [100] }).toEqual(["red", "working"]);
        await expect(page.locator("[data-scv-value]")).toHaveText("working.red");
    });

    test("parallel regions: children of every region are active, region keys are skipped", async ({ page }) => {
        await open(page, "parallel");
        expect(await activeStates(page)).toEqual(["idle"]);

        await send(page, { type: "START" });
        await expect.poll(() => activeStates(page)).toEqual(["a", "c", "p"]);
        await expect(page.locator("[data-scv-value]")).toHaveText("p.($0.a | $1.c)");

        await send(page, { type: "NEXT_A" });
        await expect.poll(() => activeStates(page)).toEqual(["b", "c", "p"]);

        await send(page, { type: "FIN_A" });
        await expect.poll(() => activeStates(page)).toEqual(["c", "p"]);

        await send(page, { type: "NEXT_C" });
        await send(page, { type: "FIN_C" });
        await expect.poll(() => activeStates(page)).toEqual(["finished"]);
    });

    test("root final maps to the [*] end node and the status becomes done", async ({ page }) => {
        await open(page, "parallel");
        for (const type of ["START", "NEXT_A", "FIN_A", "NEXT_C", "FIN_C"]) await send(page, { type });
        await expect.poll(() => activeStates(page)).toEqual(["finished"]);
        await send(page, { type: "FINISH" });
        await expect.poll(() => activeStates(page)).toEqual(["root_end"]);
        await expect(page.locator("[data-scv-status]")).toHaveText("done");
    });
});

test.describe("clicking transitions", () => {
    test("an enabled edge label sends its event and logs it", async ({ page }) => {
        await open(page, "trafficLight");
        const label = edgeLabel(page, "POWER_ON");
        await expect(label).toHaveClass(/scv-enabled/);
        await expect(edgePath(page, "POWER_ON")).toHaveClass(/scv-enabled/);

        await label.locator("span.edgeLabel").click();
        await expect.poll(() => activeStates(page)).toEqual(["green", "working"]);
        await expect(logEntries(page)).toHaveCount(1);
        await expect(logEntries(page).first()).toContainText("POWER_ON off → working.green");

        await expect(label).not.toHaveClass(/scv-enabled/);
        await expect(edgeLabel(page, "POWER_OFF")).toHaveClass(/scv-enabled/);
    });

    test("an enabled edge path sends its event", async ({ page }) => {
        await open(page, "trafficLight");
        await edgePath(page, "POWER_ON").dispatchEvent("click");
        await expect.poll(() => activeStates(page)).toEqual(["green", "working"]);
    });

    test("a disabled edge does nothing", async ({ page }) => {
        await open(page, "trafficLight");
        const reset = edgeLabel(page, "RESET");
        await expect(reset).not.toHaveClass(/scv-enabled/);

        await reset.locator("span.edgeLabel").click({ force: true });
        await edgePath(page, "RESET").dispatchEvent("click");
        await edgePath(page, "POWER_OFF").dispatchEvent("click");

        expect(await activeStates(page)).toEqual(["off"]);
        await expect(logEntries(page)).toHaveCount(0);
    });

    test("an ancestor's transition is enabled while a child is active", async ({ page }) => {
        await open(page, "trafficLight");
        await send(page, { type: "POWER_ON" });
        await expect(edgeLabel(page, "POWER_OFF")).toHaveClass(/scv-enabled/);
        await edgeLabel(page, "POWER_OFF").locator("span.edgeLabel").click();
        await expect.poll(() => activeStates(page)).toEqual(["off"]);
    });
});

test.describe("state selection and event panel", () => {
    test("clicking a state lists its events; a button sends the event", async ({ page }) => {
        await open(page, "trafficLight");
        await page.locator('[data-scv-state="off"]').click();
        await expect(page.locator('[data-scv-state="off"]')).toHaveClass(/scv-selected/);
        const button = eventButton(page, "POWER_ON");
        await expect(button).toBeEnabled();
        await button.click();
        await expect.poll(() => activeStates(page)).toEqual(["green", "working"]);
        await expect(button).toBeDisabled();
    });

    test("a nested state inherits its ancestors' events", async ({ page }) => {
        await open(page, "trafficLight");
        await send(page, { type: "POWER_ON" });
        await expect.poll(() => activeStates(page)).toEqual(["green", "working"]);
        await page.locator('[data-scv-state="green"]').click();
        await expect(eventButton(page, "POWER_OFF")).toBeEnabled();
        await expect(eventButton(page, "FAULT")).toHaveCount(0);
    });

    test("the JSON payload is merged into the event; invalid JSON disables sending", async ({ page }) => {
        await open(page, "square");
        await page.locator('[data-scv-state="idle"]').click();
        const payload = page.locator("[data-scv-payload]");

        await payload.fill("{ not json");
        await expect(eventButton(page, "SQUARE")).toBeDisabled();
        await expect(edgeLabel(page, "SQUARE").first()).not.toHaveClass(/scv-enabled/);

        await payload.fill('{ "value": 12 }');
        await expect(eventButton(page, "SQUARE")).toBeEnabled();
        await eventButton(page, "SQUARE").click();
        await expect.poll(() => activeStates(page)).toEqual(["done"]);
        await expect(page.locator("[data-scv-context]")).toContainText('"result": 144');
        await expect(logEntries(page).first()).toContainText('SQUARE {"value":12} idle → done');
    });
});

test.describe("source mode", () => {
    const status = (page: Page) => page.locator("[data-scv-status]");
    const context = (page: Page) => page.locator("[data-scv-context]");

    test("square: the proposal text is parsed, compiled and run by the library", async ({ page }) => {
        await open(page, "square", "source");
        await expect(status(page)).toHaveText("active");
        expect(await activeStates(page)).toEqual(["idle"]);

        await page.locator('[data-scv-state="idle"]').click();
        await page.locator("[data-scv-payload]").fill('{ "value": 12 }');
        await eventButton(page, "SQUARE").click();
        await expect.poll(() => activeStates(page)).toEqual(["done"]);
        await expect(context(page)).toContainText('"result": 144');

        await page.locator('[data-scv-state="done"]').click();
        await eventButton(page, "RESET").click();
        await expect.poll(() => activeStates(page)).toEqual(["idle"]);
        await expect(context(page)).toContainText('"result": null');
        await expect(context(page)).toContainText('"error": null');

        await page.locator('[data-scv-state="idle"]').click();
        await page.locator("[data-scv-payload]").fill('{ "value": null }');
        await eventButton(page, "SQUARE").click();
        await expect.poll(() => activeStates(page)).toEqual(["error"]);
        await expect(context(page)).toContainText('"error": "not a finite number"');
    });

    test("trafficLight: edge clicks, timers, the compound final and onDone; the machine is exposed", async ({
        page,
    }) => {
        await open(page, "trafficLight", "source");
        await expect(status(page)).toHaveText("active");

        await edgeLabel(page, "POWER_ON").locator("span.edgeLabel").click();
        await expect.poll(() => activeStates(page)).toEqual(["green", "working"]);
        // green → yellow after 3 s → red after 1 s, run by the library's clock.
        await expect.poll(() => activeStates(page), { timeout: 10_000, intervals: [100] }).toEqual(["red", "working"]);

        await edgeLabel(page, "FAULT").locator("span.edgeLabel").click();
        await expect.poll(() => activeStates(page)).toEqual(["broken"]);

        await send(page, { type: "RESET" });
        await expect.poll(() => activeStates(page)).toEqual(["off"]);
        await expect(context(page)).toContainText('"retries": 1');
    });

    test("a body syntax error is reported with the directive's line and no machine runs", async ({ page }) => {
        const broken = squareFixture.source.replace(
            "%% @guard isFinite: Number.isFinite(event.value)",
            "%% @guard isFinite: Number.isFinite(event.value",
        );
        await page.goto(`/?fixture=square&mode=source&source=${encodeURIComponent(broken)}`);
        await expect(page.locator('[data-scv-diagram="ready"]')).toBeVisible();
        await expect(page.locator("[data-scv-notice]")).toContainText("Parse error, line 9:");
        await expect(page.locator("[data-scv-notice]")).toContainText("@guard isFinite");
        await expect(status(page)).toHaveCount(0);
        expect(await activeStates(page)).toEqual([]);
        expect(await page.evaluate(() => (window as PlaygroundWindow).__scvPlayground?.machine)).toBeNull();
    });
});
