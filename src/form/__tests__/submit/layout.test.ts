// Server issues of a failed submit: mapSubmitError and the built-in mapper, the layout by the
// attempt snapshot (Server issues and lists, F39) and fields edited during the flight (F46).
import { z } from "zod";

import type { IssueInput } from "../../index";
import { unstable_FormSignal as FormSignal } from "../../index";

import { flush, manualCommand } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

const text = (defaultValue = "") => f({ schema: z.string(), defaultValue });

function registration(mapSubmitError?: (error: unknown) => IssueInput[]) {
    const save = manualCommand<unknown>();
    const def = g({
        fields: {
            name: text("Ann"),
            address: g({ fields: { city: text("Oslo") } }),
            phones: l({ item: g({ fields: { number: text() } }) }),
        },
        submit: ({ parsed$ }) => save.command.bind(parsed$().value),
        mapSubmitError,
    });
    const form = FormSignal.state(def, { state: { phones: [{ number: "1" }, { number: "2" }, { number: "3" }] } });
    return { ...save, form };
}

/** Submits, lets `during` run while the command is in flight, then fails the command with `error`. */
async function failWith(
    { form, last }: ReturnType<typeof registration>,
    error: unknown,
    during: () => void = () => {},
) {
    const result = form.submit();
    await flush();
    during();
    last().reject(error);
    expect(await result).toBe(false);
}

const messages = (issues: { message: string }[]) => issues.map((issue) => issue.message);

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("the built-in mapper", () => {
    it("lays Standard Schema issues out by path; Issue.path stays as the server sent it", async () => {
        const setup = registration();
        await failWith(setup, {
            issues: [
                { message: "Unknown city", path: ["address", { key: "city" }] },
                { message: "Bad number", path: ["phones", 1, "number"], code: "phone" },
                { message: "Try later" },
            ],
        });
        const { form } = setup;
        expect(form.fields.address.fields.city.issues$()).toEqual([
            { path: ["address", "city"], message: "Unknown city", severity: "error", source: { type: "server" } },
        ]);
        expect(form.fields.phones.items$()[1].fields.number.issues$()).toEqual([
            {
                path: ["phones", 1, "number"],
                message: "Bad number",
                severity: "error",
                source: { type: "server" },
                code: "phone",
            },
        ]);
        expect(messages(form.ownIssues$())).toEqual(["Try later"]);
    });

    it("otherwise a non-empty string message is one form issue", async () => {
        const setup = registration();
        await failWith(setup, new Error("Service unavailable"));
        expect(setup.form.ownIssues$()).toEqual([
            { path: [], message: "Service unavailable", severity: "error", source: { type: "server" } },
        ]);
    });

    it('otherwise one form issue with a fixed message and code "unknown"', async () => {
        for (const error of ["boom", { message: "" }, null, { issues: [] }]) {
            const setup = registration();
            await failWith(setup, error);
            expect(setup.form.ownIssues$()).toEqual([
                {
                    path: [],
                    message: "The form could not be submitted",
                    severity: "error",
                    source: { type: "server" },
                    code: "unknown",
                },
            ]);
        }
    });
});

describe("mapSubmitError", () => {
    it("receives the error after the api's mapError; source is set by the form, severity defaults to error", async () => {
        const seen: unknown[] = [];
        const save = manualCommand<unknown, { id: string }, { reason: string }>({
            mapError: (error) => ({ reason: String((error as Error).message) }),
        });
        const def = g({
            fields: { name: text("Ann") },
            submit: ({ parsed$ }) => save.command.bind(parsed$().value),
            mapSubmitError: (error) => {
                seen.push(error);
                return [
                    { path: ["name"], message: error.reason, code: "taken" },
                    { message: "Check the name", severity: "warning" },
                ];
            },
        });
        const form = FormSignal.state(def);
        const result = form.submit();
        await flush();
        save.last().reject(new Error("Name taken"));
        expect(await result).toBe(false);
        expect(seen).toEqual([{ reason: "Name taken" }]);
        expect(form.fields.name.issues$()).toEqual([
            { path: ["name"], message: "Name taken", severity: "error", source: { type: "server" }, code: "taken" },
        ]);
        expect(form.ownIssues$()).toEqual([
            { path: [], message: "Check the name", severity: "warning", source: { type: "server" } },
        ]);
    });

    it("a throw, or a result that is not issue inputs: console.error and the built-in mapper", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const throwing = registration(() => {
            throw new Error("mapper bug");
        });
        await failWith(throwing, new Error("Down"));
        expect(messages(throwing.form.ownIssues$())).toEqual(["Down"]);

        const malformed = registration(() => [{ text: "no message" }] as never);
        await failWith(malformed, new Error("Down"));
        expect(messages(malformed.form.ownIssues$())).toEqual(["Down"]);
        expect(errors).toHaveBeenCalledTimes(2);
        expect(String(errors.mock.calls[0][0])).toContain("mapSubmitError threw");
    });
});

describe("layout by the attempt snapshot", () => {
    it("list indices resolve through the sent key order: rows reordered during the flight get their own issues", async () => {
        const setup = registration();
        const { phones } = setup.form.fields;
        const [one, two, three] = phones.items$();
        await failWith(setup, { issues: [{ message: "Bad", path: ["phones", 0, "number"] }] }, () => {
            phones.move(one, 2);
        });
        expect(messages(one.fields.number.issues$())).toEqual(["Bad"]);
        expect(two.fields.number.issues$()).toEqual([]);
        expect(three.fields.number.issues$()).toEqual([]);
        // outside, the path is the server's
        expect(one.fields.number.issues$()[0].path).toEqual(["phones", 0, "number"]);
    });

    it("a row removed since the snapshot: the issue lands on the deepest node that is still there", async () => {
        const setup = registration();
        const { phones } = setup.form.fields;
        const [, two] = phones.items$();
        await failWith(setup, { issues: [{ message: "Bad", path: ["phones", 1, "number"] }] }, () => {
            phones.remove(two);
        });
        expect(messages(phones.ownIssues$())).toEqual(["Bad"]);
        expect(two.fields.number.issues$()).toEqual([]);
    });

    it("a path whose target was not in the snapshot lands on the deepest ancestor that was", async () => {
        const setup = registration();
        await failWith(setup, {
            issues: [
                { message: "Unknown field", path: ["address", "zip"] },
                { message: "Row 7", path: ["phones", 7, "number"] },
                { message: "Too deep", path: ["name", "first"] },
                { message: "Nowhere", path: ["missing"] },
            ],
        });
        const { form } = setup;
        expect(messages(form.fields.address.ownIssues$())).toEqual(["Unknown field"]);
        expect(messages(form.fields.phones.ownIssues$())).toEqual(["Row 7"]);
        expect(messages(form.fields.name.issues$())).toEqual(["Too deep"]);
        expect(messages(form.ownIssues$())).toEqual(["Nowhere"]);
    });

    it("a disabled child was not sent: its issue lands on the group", async () => {
        const save = manualCommand<unknown>();
        const def = g({
            fields: { company: f({ schema: z.boolean(), defaultValue: false }), vatId: text() },
            disabled: { vatId: ({ fields }) => !fields.company.value$() },
            submit: ({ parsed$ }) => save.command.bind(parsed$().value),
        });
        const form = FormSignal.state(def);
        const result = form.submit();
        await flush();
        save.last().reject({ issues: [{ message: "Required", path: ["vatId"] }] });
        await result;
        expect(messages(form.ownIssues$())).toEqual(["Required"]);
        expect(form.fields.vatId.issues$()).toEqual([]);
    });

    it("F46: an issue on a field edited since the snapshot is dropped", async () => {
        const setup = registration();
        const { form } = setup;
        await failWith(
            setup,
            {
                issues: [
                    { message: "Name taken", path: ["name"] },
                    { message: "Unknown city", path: ["address", "city"] },
                ],
            },
            () => form.fields.name.set("Bob"),
        );
        expect(form.fields.name.issues$()).toEqual([]);
        expect(messages(form.fields.address.fields.city.issues$())).toEqual(["Unknown city"]);
    });

    it("server issues leave a field on its set(), and the whole tree on clearIssues()", async () => {
        const setup = registration();
        const { form } = setup;
        await failWith(setup, {
            issues: [
                { message: "Name taken", path: ["name"] },
                { message: "Unknown city", path: ["address", "city"] },
            ],
        });
        form.fields.name.set("Bob");
        expect(form.fields.name.issues$()).toEqual([]);
        expect(form.issues$()).toHaveLength(1);
        form.clearIssues();
        expect(form.issues$()).toEqual([]);
    });
});
