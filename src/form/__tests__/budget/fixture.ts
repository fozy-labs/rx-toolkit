// Type-budget fixture: a realistic form of 40 fields, 3 nested groups, 2 lists, 10 queries and
// 5 computed, with rules, `disabled`, a context and `submit`, plus the instance reads a UI does.
// `twin.ts` is the same program without the form. See `budget.test.ts`.
import { z } from "zod";

import { unstable_FormSignal as FormSignal, type FormInstance, type IssueInput } from "../../index";

import {
    getContactInfo,
    getEmailInfo,
    getIban,
    getIndustries,
    getPlans,
    getPricing,
    getReferral,
    getRegions,
    getVat,
    getZip,
    register,
    type ApiError,
} from "./api";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

function netIssues(error: ApiError): IssueInput[] {
    return error.issues?.map((issue) => ({ path: issue.path, message: issue.message })) ?? [{ message: error.message }];
}

// ==================== Root fields (15) ====================

const firstName = f({ schema: z.string().min(1), defaultValue: "", required: true });
const middleName = f({ schema: z.string(), defaultValue: "" });
const lastName = f({ schema: z.string().min(1), defaultValue: "", required: true });
const email = f({
    schema: z.email().trim(),
    defaultValue: "",
    showErrors: "touched",
    queries: {
        emailInfo: {
            bind: ({ parsed$ }) => {
                const parsed = parsed$();
                return parsed.isParsed && getEmailInfo.bind(parsed.value);
            },
            debounce: 300,
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
const phone = f({ schema: z.string().regex(/^\+?[0-9 ]*$/), defaultValue: "" });
const birthDate = f({ schema: z.iso.date(), defaultValue: "" });
const gender = f({ schema: z.enum(["female", "male", "other"]).optional(), defaultValue: undefined });
const locale = f({ schema: z.enum(["en", "de", "fr"]), defaultValue: "en" });
const timezone = f({ schema: z.string(), defaultValue: "UTC" });
const password = f({ schema: z.string().min(8), defaultValue: "", showErrors: "modified" });
const confirmPassword = f({ schema: z.string(), defaultValue: "" });
const acceptTerms = f({
    schema: z.boolean(),
    defaultValue: false,
    validate: { accepted: ({ value$, error }) => (value$() ? undefined : error("Accept the terms")) },
});
const newsletter = f({ schema: z.boolean(), defaultValue: false });
const notes = f({ schema: z.string().max(500), defaultValue: "" });
const referralCode = f({
    schema: z.string(),
    defaultValue: "",
    context: FormSignal.context<{ tenantId: string }>(),
    queries: {
        referral: ({ value$, context$ }) =>
            value$().length > 3 && getReferral.bind(`${context$().tenantId}:${value$()}`),
    },
    validate: ({ queries, warn }) => {
        const referral = queries.referral$();
        if (referral.status === "success" && referral.data === null) warn("Unknown referral code");
    },
});

// ==================== Company (7) with the nested address (5) ====================

const street = f({ schema: z.string().min(1), defaultValue: "" });
const city = f({ schema: z.string().min(1), defaultValue: "" });
const zip = f({ schema: z.string().regex(/^[0-9]{4,6}$/), defaultValue: "" });
const country = f({ schema: z.enum(["DE", "FR", "US"]), defaultValue: "DE" });
const region = f({ schema: z.string(), defaultValue: "" });

const address = g({
    fields: { street, city, zip, country, region },
    computed: {
        oneLine: ({ fields }) => `${fields.street.value$()}, ${fields.zip.value$()} ${fields.city.value$()}`,
    },
    queries: {
        zipLookup: {
            bind: ({ fields }) => {
                const zipCode = fields.zip.parsed$();
                return zipCode.isParsed && getZip.bind({ country: fields.country.value$(), zip: zipCode.value });
            },
            debounce: 200,
        },
        regions: ({ fields }) => getRegions.bind(fields.country.value$()),
    },
    validate: {
        cityMatchesZip: ({ fields, queries, warn }) => {
            const cities = queries.zipLookup$();
            if (queries.zipLookup.isDebouncing$() || cities.dataSource !== "current") return;
            if (!cities.data.some((c) => c.city === fields.city.value$())) warn(fields.city, "City does not match");
        },
        region: ({ fields, queries, error }) => {
            const regions = queries.regions$();
            if (regions.hasData && fields.region.value$() && !regions.data.includes(fields.region.value$()))
                error(fields.region, "Unknown region", { code: "region" });
        },
    },
});

const companyName = f({ schema: z.string().min(2), defaultValue: "" });
const vatId = f({ schema: z.string().regex(/^[A-Z]{2}[0-9]+$/), defaultValue: "" });
const companySize = f({ schema: z.enum(["small", "medium", "large"]), defaultValue: "small" });
const industry = f({ schema: z.string(), defaultValue: "" });
const website = f({ schema: z.url().or(z.literal("")), defaultValue: "" });
const foundedYear = f({ schema: z.number().int().min(1800), defaultValue: 2000 });
const employees = f({ schema: z.number().int().min(1), defaultValue: 1 });

const company = g({
    fields: { companyName, vatId, companySize, industry, website, foundedYear, employees, address },
    computed: {
        displayName: ({ fields }) => `${fields.companyName.value$()} (${fields.address.fields.country.value$()})`,
    },
    queries: {
        vatCheck: ({ fields }) => {
            const vat = fields.vatId.parsed$();
            return vat.isParsed && getVat.bind({ country: fields.address.fields.country.value$(), vatId: vat.value });
        },
        industries: ({ fields }) => getIndustries.bind(fields.companySize.value$()),
    },
    validate: ({ fields, queries, error }) => {
        const vat = queries.vatCheck$();
        if (vat.status === "success" && !vat.data.valid) error(fields.vatId, "Invalid VAT id");
    },
    disabled: {
        vatId: ({ fields }) => fields.address.fields.country.value$() === "US",
    },
});

// ==================== Billing (6) ====================

const iban = f({
    schema: z.string().min(15),
    defaultValue: "",
    queries: {
        ibanCheck: ({ parsed$ }) => {
            const parsed = parsed$();
            return parsed.isParsed ? getIban.bind(parsed.value) : null;
        },
    },
});
const bic = f({ schema: z.string(), defaultValue: "" });
const billingEmail = f({ schema: z.email().or(z.literal("")), defaultValue: "" });
const plan = f({ schema: z.enum(["free", "pro", "enterprise"]), defaultValue: "free" });
const costCenter = f({ schema: z.string(), defaultValue: "" });
const poNumber = f({ schema: z.string(), defaultValue: "" });

const billing = g({
    fields: { iban, bic, billingEmail, plan, costCenter, poNumber },
    computed: {
        summary: ({ fields }) => `${fields.plan.value$()} / ${fields.iban.value$().slice(-4)}`,
    },
    validate: {
        poForEnterprise: ({ fields, error }) => {
            if (fields.plan.value$() === "enterprise" && !fields.poNumber.value$())
                error(fields.poNumber, "A PO number is required for enterprise");
        },
    },
    disabled: {
        costCenter: ({ fields }) => fields.plan.value$() === "free",
        poNumber: ({ fields }) => fields.plan.value$() !== "enterprise",
    },
});

// ==================== Lists: contacts (5 per row), tags (1) ====================

const contacts = l({
    item: g({
        fields: {
            name: f({ schema: z.string().min(1), defaultValue: "" }),
            role: f({ schema: z.enum(["owner", "admin", "member"]), defaultValue: "member" }),
            email: f({
                schema: z.email(),
                defaultValue: "",
                queries: {
                    known: ({ parsed$ }) => {
                        const parsed = parsed$();
                        return parsed.isParsed && getContactInfo.bind(parsed.value);
                    },
                },
            }),
            phone: f({ schema: z.string(), defaultValue: "" }),
            isPrimary: f({ schema: z.boolean(), defaultValue: false }),
        },
    }),
    validate: ({ items$, error }) => {
        const primary = items$().filter((item) => item.fields.isPrimary.value$());
        if (primary.length > 1) error("Only one primary contact");
        if (items$().length > 10) error("At most ten contacts");
    },
});

const tags = l({
    item: f({ schema: z.string().min(1).max(20), defaultValue: "" }),
    defaultValue: ["new"],
    validate: ({ value$, warn }) => {
        if (new Set(value$()).size !== value$().length) warn("Duplicate tags");
    },
});

// ==================== Root ====================

export const RegistrationForm = g({
    name: "registration",
    context: FormSignal.context<{ tenantId: string; userId: string }>(),
    fields: {
        firstName,
        middleName,
        lastName,
        email,
        phone,
        birthDate,
        gender,
        locale,
        timezone,
        password,
        confirmPassword,
        acceptTerms,
        newsletter,
        notes,
        referralCode,
        company,
        billing,
        contacts,
        tags,
    },
    computed: {
        fullName: ({ fields }) => `${fields.firstName.value$()} ${fields.lastName.value$()}`,
        contactCount: ({ fields }) => fields.contacts.items$().length,
    },
    queries: {
        plans: ({ context$ }) => getPlans.bind({ tenantId: context$().tenantId }),
        pricing: ({ fields, computed }) =>
            computed.contactCount$() !== undefined &&
            getPricing.bind({ plan: fields.billing.fields.plan.value$(), seats: fields.contacts.items$().length }),
    },
    validate: {
        passwordsMatch: ({ fields, error }) => {
            if (fields.password.value$() !== fields.confirmPassword.value$())
                error(fields.confirmPassword, "Passwords do not match");
        },
        nameOrEmail: ({ fields, error }) => {
            if (!fields.firstName.value$() && !fields.email.value$()) error("Fill in the name or the email");
        },
        planAvailable: ({ queries, fields, warn }) => {
            const plans = queries.plans$();
            if (plans.hasData && !plans.data.some((p) => p.id === fields.billing.fields.plan.value$()))
                warn(fields.billing, "The plan is not available");
        },
    },
    disabled: {
        billing: ({ fields, context$ }) => fields.newsletter.value$() && context$().tenantId === "",
    },
    submit: ({ parsed$, context$ }) => {
        const value = parsed$().value;
        return register.bind(
            {
                firstName: value.firstName,
                lastName: value.lastName,
                email: value.email,
                company: { companyName: value.company.companyName, vatId: value.company.vatId },
                billing: value.billing && { iban: value.billing.iban, plan: value.billing.plan },
                contacts: value.contacts.map((contact) => ({ name: contact.name, email: contact.email })),
                tags: value.tags,
            },
            context$().userId,
        );
    },
    mapSubmitError: netIssues,
    pendingQueries: "wait",
});

// ==================== Instance reads ====================

export function useRegistration(form: FormInstance<typeof RegistrationForm>) {
    const root = form.state$();
    const emailState = form.fields.email$();
    const emailInfo = form.fields.email.queries.emailInfo$();
    const zipCities = form.fields.company.fields.address.queries.zipLookup$();
    const vat = form.fields.company.queries.vatCheck$();
    const firstContact = form.fields.contacts.items$()[0];
    const submission = form.submission$();

    form.fields.email.set("a@b.c");
    form.fields.company.fields.address.fields.country.set("FR");
    form.fields.billing.fields.plan.set("pro");
    form.fields.contacts.push({ name: "Ann", role: "owner" });
    form.fields.tags.insert(0, "vip");
    form.fields.company.initialize({ state: { companyName: "ACME", address: { city: "Berlin" } } });
    form.initialize({ context: { tenantId: "t", userId: "u" } }, { keepDirtyValues: true });
    void form.submit();

    return {
        canSubmit: root.canSubmit && !root.isSubmitting,
        emailError: emailState.visibleErrors[0]?.message,
        corporate: emailInfo.hasData && emailInfo.data.isCorporate,
        cities: zipCities.hasData ? zipCities.data.map((c) => c.city) : [],
        vatName: vat.status === "success" ? vat.data.name : undefined,
        contactName: firstContact?.fields.name.value$(),
        contactKnown: firstContact?.fields.email.queries.known$().data?.known,
        fullName: form.computed.fullName$(),
        oneLine: form.fields.company.fields.address.computed.oneLine$(),
        billingPlan: form.fields.billing.value$()?.plan,
        submittedId: submission?.status === "success" ? submission.data.id : undefined,
        tenant: form.context$().tenantId,
        parsed: form.parsed$(),
    };
}

export const instance = FormSignal.state(RegistrationForm, {
    context: { tenantId: "t", userId: "u" },
    state: { firstName: "Ann", company: { address: { country: "FR" } }, tags: ["a"] },
    key: "registration/1",
});
