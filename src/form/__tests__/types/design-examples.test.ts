/**
 * Every example of the design type-checks as intended. `api.defineForm` arrives with the plugin;
 * until then the root definition is built with `FormSignal.group`, which takes the same options.
 * Instance reads live in functions that are never called: `FormSignal.state()` has no runtime yet.
 */
import { expectTypeOf } from "vitest";
import { z } from "zod";

import type { TResourceClutchState } from "@/query";
import type { ReadonlySignal } from "@/signals";
import { useSignal } from "@/signals";

import {
    unstable_FormSignal as FormSignal,
    type FieldState,
    type FormContext,
    type FormInit,
    type FormInitial,
    type FormInput,
    type FormInstance,
    type FormOutput,
    type FormState,
    type InitializeOptions,
    type Issue,
    type ItemNode,
    type Parsed,
} from "../../index";

import {
    getEmailInfo,
    getTariffs,
    netIssues,
    registerCommand,
    type EmailInfo,
    type NetError,
    type RegistrationArgs,
} from "./fixtures";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

// ==================== Definition ====================

const email = f({
    schema: z.email().trim(),
    defaultValue: "",
    showErrors: "touched",
    queries: {
        emailInfo: ({ parsed$ }) => {
            const parsed = parsed$();
            return parsed.isParsed && getEmailInfo.bind(parsed.value);
        },
    },
    validate: ({ queries, error, warn }) => {
        const info = queries.emailInfo$();
        if (queries.emailInfo.isDebouncing$() || info.dataSource !== "current") return;
        if (info.status === "error") return warn("Could not check the email");
        if (!info.data.isValid) error("Email is taken");
        if (info.data.isCorporate) warn("Corporate address");
    },
});

const name = f({ schema: z.string(), defaultValue: "" });
const tariff = f({ schema: z.enum(["free", "pro"]), defaultValue: "free" });
const addedServices = f({ schema: z.array(z.string()), defaultValue: [] });
const kind = f({ schema: z.enum(["mobile", "home"]), defaultValue: "mobile" });
const number = f({ schema: z.string().min(3), defaultValue: "" });

const services = g({
    fields: { tariff, addedServices },
    validate: {
        freeTariff: ({ fields, error }) => {
            if (fields.tariff.value$() === "free" && fields.addedServices.value$().length)
                error(fields.addedServices, "Not available on the free tariff");
        },
    },
});

const phones = l({
    item: g({ fields: { kind, number } }),
    validate: ({ items$, error }) => {
        if (items$().length > 5) error("At most five");
    },
});

const RegistrationForm = g({
    name: "registration",
    fields: { name, email, services, phones },
    computed: {
        emailPlaceholder: ({ fields }) => `${fields.name.value$()}@company.com`,
    },
    queries: {
        tariffs: ({ fields }) => {
            const selected = fields.services.fields.tariff.parsed$();
            return selected.isParsed && getTariffs.bind(selected.value);
        },
    },
    validate: ({ fields, error }) => {
        if (!fields.name.value$() && !fields.email.value$()) error("Fill in the name or the email");
    },
    submit: ({ parsed$ }) => registerCommand.bind(parsed$().value),
    mapSubmitError: netIssues,
    pendingQueries: "wait",
});

type Form = FormInstance<typeof RegistrationForm>;

describe("design examples", () => {
    it("Field: queries and a rule over the query state", () => {
        type EmailNode = FormInstance<typeof RegistrationForm>["fields"]["email"];
        expectTypeOf<ReturnType<EmailNode["queries"]["emailInfo$"]>>().toEqualTypeOf<
            TResourceClutchState<string, EmailInfo, NetError>
        >();
        expectTypeOf<EmailNode["queries"]["emailInfo"]["isDebouncing$"]>().toEqualTypeOf<ReadonlySignal<boolean>>();
        expectTypeOf<FormInput<typeof email>>().toEqualTypeOf<string>();
    });

    it("Group and root: the values compose from the children", () => {
        expectTypeOf<FormInput<typeof services>>().toEqualTypeOf<{
            tariff: "free" | "pro";
            addedServices: string[];
        }>();
        expectTypeOf<FormOutput<typeof RegistrationForm>>().toEqualTypeOf<RegistrationArgs>();
        expectTypeOf<FormInitial<typeof RegistrationForm>>().toEqualTypeOf<{
            name?: string;
            email?: string;
            services?: { tariff?: "free" | "pro"; addedServices?: string[] };
            phones?: { kind?: "mobile" | "home"; number?: string }[];
        }>();
        expectTypeOf<FormContext<typeof RegistrationForm>>().toBeUnknown();
    });

    it("Group: computed and queries of the root", () => {
        expectTypeOf<Form["computed"]["emailPlaceholder$"]>().toEqualTypeOf<ReadonlySignal<string | undefined>>();
        expectTypeOf<ReturnType<Form["queries"]["tariffs$"]>>().toEqualTypeOf<
            TResourceClutchState<"free" | "pro", string[], NetError>
        >();
        expectTypeOf<ReturnType<Form["queries"]["tariffs$"]>["data"]>().not.toBeAny();
    });

    it("List: items are keyed item nodes", () => {
        type Phones = Form["fields"]["phones"];
        type Row = ItemNode<Phones extends { items$: ReadonlySignal<(infer R)[]> } ? R : never>;
        expectTypeOf<Row["key"]>().toEqualTypeOf<string>();
        expectTypeOf<Row["fields"]["kind"]["value$"]>().toEqualTypeOf<ReadonlySignal<"mobile" | "home">>();
        expectTypeOf<FormInput<typeof phones>>().toEqualTypeOf<{ kind: "mobile" | "home"; number: string }[]>();
    });

    it("Instance: FormSignal.state and the node members", () => {
        function create(state: FormInitial<typeof RegistrationForm>, context: unknown) {
            return FormSignal.state(RegistrationForm, { state, context, key: "registration/1" });
        }
        expectTypeOf(create).returns.toEqualTypeOf<Form>();
        expectTypeOf<FormInit<typeof RegistrationForm>>().toExtend<{
            state?: FormInitial<typeof RegistrationForm>;
            key?: string;
        }>();

        function reads(form: Form) {
            expectTypeOf(form.fields.email.value$()).toEqualTypeOf<string>();
            form.fields.services.fields.tariff.set("pro");
            form.fields.phones.push();
            expectTypeOf(form.fields.email$()).toEqualTypeOf<FieldState<string, string>>();
            expectTypeOf(form.fields.email$).toEqualTypeOf(form.fields.email.state$);
            expectTypeOf(form.fields.services$).toEqualTypeOf(form.fields.services.state$);
            expectTypeOf(form.state$()).toEqualTypeOf<FormState>();
            expectTypeOf(form.fields.phones$().items).toEqualTypeOf(form.fields.phones.items$());
        }
        void reads;
    });

    it("Root members: context, submit state, initialize", () => {
        function reads(form: Form) {
            expectTypeOf(form.submit).toEqualTypeOf<(options?: { force?: boolean }) => Promise<boolean>>();
            expectTypeOf(form.entryKey).toEqualTypeOf<string>();
            expectTypeOf(form.status$()).toEqualTypeOf<"idle" | "invalid" | "submitting" | "error" | "success">();
            const submission = form.submission$();
            if (submission?.status === "success") expectTypeOf(submission.data).toEqualTypeOf<{ id: string }>();
            if (submission?.status === "error") expectTypeOf(submission.error).toEqualTypeOf<NetError>();
            expectTypeOf(submission).not.toHaveProperty("retry");
            expectTypeOf(form.initialize)
                .parameter(0)
                .toEqualTypeOf<{ state?: FormInitial<typeof RegistrationForm>; context?: unknown } | undefined>();
            expectTypeOf(form.initialize).parameter(1).toEqualTypeOf<InitializeOptions | undefined>();
            expectTypeOf(form.fields.services.initialize)
                .parameter(0)
                .toEqualTypeOf<{ state?: FormInitial<typeof services> } | undefined>();
            form.clearIssues();
        }
        void reads;
    });

    it("React: nodes are read with useSignal", () => {
        function View(form: Form) {
            const emailState = useSignal(form.fields.email$);
            const phonesState = useSignal(form.fields.phones$);
            const root = useSignal(form.state$);
            const info = useSignal(form.fields.email.queries.emailInfo$);

            expectTypeOf(emailState.visibleErrors).toEqualTypeOf<Issue[]>();
            expectTypeOf(emailState.visibleErrors[0]?.message).toEqualTypeOf<string>();
            expectTypeOf(phonesState.items).toEqualTypeOf(form.fields.phones.items$());
            expectTypeOf(root.canSubmit).toEqualTypeOf<boolean>();
            expectTypeOf(info).toEqualTypeOf<TResourceClutchState<string, EmailInfo, NetError>>();

            const onValueChange: (value: string) => void = form.fields.email.set;
            const onBlur: () => void = form.fields.email.blur;
            return [onValueChange, onBlur, emailState.value, emailState.parsed satisfies Parsed<string>];
        }
        void View;
    });

    it("Outside React: a subscription holds the activity", () => {
        function run(form: Form, render: (state: FormState) => void) {
            const sub = form.state$.obs.subscribe(render);
            sub.unsubscribe();
        }
        void run;
    });
});
