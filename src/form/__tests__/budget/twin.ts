// The form-free twin of `fixture.ts`: the same schemas, resources, command and callback bodies
// as plain objects and functions with explicit types, and the same kind of reads on plain
// signals. Its cost is the baseline the fixture is measured against. See `budget.test.ts`.
import { z } from "zod";

import type { TCommandClutchState, TResourceClutchState } from "@/query";
import type { ReadonlySignal } from "@/signals/types";

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
    type RegistrationArgs,
} from "./api";

type Parsed<T> = { isParsed: true; value: T } | { isParsed: false; value: undefined };
type Collect = (message: string, options?: { code?: string }) => void;
type Issue = { path?: (string | number)[]; message: string };

function netIssues(error: ApiError): Issue[] {
    return error.issues?.map((issue) => ({ path: issue.path, message: issue.message })) ?? [{ message: error.message }];
}

// ==================== Root fields (15) ====================

const firstName = { schema: z.string().min(1), defaultValue: "", required: true };
const middleName = { schema: z.string(), defaultValue: "" };
const lastName = { schema: z.string().min(1), defaultValue: "", required: true };
const email = {
    schema: z.email().trim(),
    defaultValue: "",
    showErrors: "touched",
    queries: {
        emailInfo: {
            bind: (parsed$: ReadonlySignal<Parsed<string>>) => {
                const parsed = parsed$();
                return parsed.isParsed && getEmailInfo.bind(parsed.value);
            },
            debounce: 300,
        },
    },
    validate: (
        info$: ReadonlySignal<TResourceClutchState<string, { isValid: boolean; isCorporate: boolean }, ApiError>>,
        isDebouncing$: ReadonlySignal<boolean>,
        error: Collect,
        warn: Collect,
    ) => {
        const info = info$();
        if (isDebouncing$() || info.dataSource !== "current") return;
        if (info.status === "error") return warn("Could not check the email");
        if (!info.data.isValid) error("Email is taken");
        if (info.data.isCorporate) warn("Corporate address");
    },
};
const phone = { schema: z.string().regex(/^\+?[0-9 ]*$/), defaultValue: "" };
const birthDate = { schema: z.iso.date(), defaultValue: "" };
const gender = { schema: z.enum(["female", "male", "other"]).optional(), defaultValue: undefined };
const locale = { schema: z.enum(["en", "de", "fr"]), defaultValue: "en" };
const timezone = { schema: z.string(), defaultValue: "UTC" };
const password = { schema: z.string().min(8), defaultValue: "", showErrors: "modified" };
const confirmPassword = { schema: z.string(), defaultValue: "" };
const acceptTerms = {
    schema: z.boolean(),
    defaultValue: false,
    validate: {
        accepted: (value$: ReadonlySignal<boolean>, error: Collect) =>
            value$() ? undefined : error("Accept the terms"),
    },
};
const newsletter = { schema: z.boolean(), defaultValue: false };
const notes = { schema: z.string().max(500), defaultValue: "" };
const referralCode = {
    schema: z.string(),
    defaultValue: "",
    queries: {
        referral: (value$: ReadonlySignal<string>, context$: ReadonlySignal<{ tenantId: string }>) =>
            value$().length > 3 && getReferral.bind(`${context$().tenantId}:${value$()}`),
    },
    validate: (
        referral$: ReadonlySignal<TResourceClutchState<string, { owner: string } | null, ApiError>>,
        warn: Collect,
    ) => {
        const referral = referral$();
        if (referral.status === "success" && referral.data === null) warn("Unknown referral code");
    },
};

// ==================== Company (7) with the nested address (5) ====================

const street = { schema: z.string().min(1), defaultValue: "" };
const city = { schema: z.string().min(1), defaultValue: "" };
const zip = { schema: z.string().regex(/^[0-9]{4,6}$/), defaultValue: "" };
const country = { schema: z.enum(["DE", "FR", "US"]), defaultValue: "DE" };
const region = { schema: z.string(), defaultValue: "" };

type AddressValue = { street: string; city: string; zip: string; country: "DE" | "FR" | "US"; region: string };
type Inputs<T> = { [K in keyof T]: { value$: ReadonlySignal<T[K]>; parsed$: ReadonlySignal<Parsed<T[K]>> } };

const address = {
    fields: { street, city, zip, country, region },
    computed: {
        oneLine: (fields: Inputs<AddressValue>) =>
            `${fields.street.value$()}, ${fields.zip.value$()} ${fields.city.value$()}`,
    },
    queries: {
        zipLookup: {
            bind: (fields: Inputs<AddressValue>) => {
                const zipCode = fields.zip.parsed$();
                return zipCode.isParsed && getZip.bind({ country: fields.country.value$(), zip: zipCode.value });
            },
            debounce: 200,
        },
        regions: (fields: Inputs<AddressValue>) => getRegions.bind(fields.country.value$()),
    },
    validate: {
        cityMatchesZip: (
            fields: Inputs<AddressValue>,
            cities$: ReadonlySignal<
                TResourceClutchState<{ country: string; zip: string }, { city: string }[], ApiError>
            >,
            isDebouncing$: ReadonlySignal<boolean>,
            warn: (node: unknown, message: string) => void,
        ) => {
            const cities = cities$();
            if (isDebouncing$() || cities.dataSource !== "current") return;
            if (!cities.data.some((c) => c.city === fields.city.value$())) warn(fields.city, "City does not match");
        },
        region: (
            fields: Inputs<AddressValue>,
            regions$: ReadonlySignal<TResourceClutchState<string, string[], ApiError>>,
            error: (node: unknown, message: string, options?: { code?: string }) => void,
        ) => {
            const regions = regions$();
            if (regions.hasData && fields.region.value$() && !regions.data.includes(fields.region.value$()))
                error(fields.region, "Unknown region", { code: "region" });
        },
    },
};

const companyName = { schema: z.string().min(2), defaultValue: "" };
const vatId = { schema: z.string().regex(/^[A-Z]{2}[0-9]+$/), defaultValue: "" };
const companySize = { schema: z.enum(["small", "medium", "large"]), defaultValue: "small" };
const industry = { schema: z.string(), defaultValue: "" };
const website = { schema: z.url().or(z.literal("")), defaultValue: "" };
const foundedYear = { schema: z.number().int().min(1800), defaultValue: 2000 };
const employees = { schema: z.number().int().min(1), defaultValue: 1 };

type CompanyValue = {
    companyName: string;
    vatId: string;
    companySize: "small" | "medium" | "large";
    industry: string;
    website: string;
    foundedYear: number;
    employees: number;
};
type CompanyInputs = Inputs<CompanyValue> & { address: { fields: Inputs<AddressValue> } };

const company = {
    fields: { companyName, vatId, companySize, industry, website, foundedYear, employees, address },
    computed: {
        displayName: (fields: CompanyInputs) =>
            `${fields.companyName.value$()} (${fields.address.fields.country.value$()})`,
    },
    queries: {
        vatCheck: (fields: CompanyInputs) => {
            const vat = fields.vatId.parsed$();
            return vat.isParsed && getVat.bind({ country: fields.address.fields.country.value$(), vatId: vat.value });
        },
        industries: (fields: CompanyInputs) => getIndustries.bind(fields.companySize.value$()),
    },
    validate: (
        fields: CompanyInputs,
        vat$: ReadonlySignal<
            TResourceClutchState<{ country: string; vatId: string }, { valid: boolean; name: string }, ApiError>
        >,
        error: (node: unknown, message: string) => void,
    ) => {
        const vat = vat$();
        if (vat.status === "success" && !vat.data.valid) error(fields.vatId, "Invalid VAT id");
    },
    disabled: {
        vatId: (fields: CompanyInputs) => fields.address.fields.country.value$() === "US",
    },
};

// ==================== Billing (6) ====================

const iban = {
    schema: z.string().min(15),
    defaultValue: "",
    queries: {
        ibanCheck: (parsed$: ReadonlySignal<Parsed<string>>) => {
            const parsed = parsed$();
            return parsed.isParsed ? getIban.bind(parsed.value) : null;
        },
    },
};
const bic = { schema: z.string(), defaultValue: "" };
const billingEmail = { schema: z.email().or(z.literal("")), defaultValue: "" };
const plan = { schema: z.enum(["free", "pro", "enterprise"]), defaultValue: "free" };
const costCenter = { schema: z.string(), defaultValue: "" };
const poNumber = { schema: z.string(), defaultValue: "" };

type BillingValue = {
    iban: string;
    bic: string;
    billingEmail: string;
    plan: "free" | "pro" | "enterprise";
    costCenter: string;
    poNumber: string;
};

const billing = {
    fields: { iban, bic, billingEmail, plan, costCenter, poNumber },
    computed: {
        summary: (fields: Inputs<BillingValue>) => `${fields.plan.value$()} / ${fields.iban.value$().slice(-4)}`,
    },
    validate: {
        poForEnterprise: (fields: Inputs<BillingValue>, error: (node: unknown, message: string) => void) => {
            if (fields.plan.value$() === "enterprise" && !fields.poNumber.value$())
                error(fields.poNumber, "A PO number is required for enterprise");
        },
    },
    disabled: {
        costCenter: (fields: Inputs<BillingValue>) => fields.plan.value$() === "free",
        poNumber: (fields: Inputs<BillingValue>) => fields.plan.value$() !== "enterprise",
    },
};

// ==================== Lists: contacts (5 per row), tags (1) ====================

type ContactValue = {
    name: string;
    role: "owner" | "admin" | "member";
    email: string;
    phone: string;
    isPrimary: boolean;
};
type ContactItem = { key: string; fields: Inputs<ContactValue> };

const contacts = {
    item: {
        fields: {
            name: { schema: z.string().min(1), defaultValue: "" },
            role: { schema: z.enum(["owner", "admin", "member"]), defaultValue: "member" },
            email: {
                schema: z.email(),
                defaultValue: "",
                queries: {
                    known: (parsed$: ReadonlySignal<Parsed<string>>) => {
                        const parsed = parsed$();
                        return parsed.isParsed && getContactInfo.bind(parsed.value);
                    },
                },
            },
            phone: { schema: z.string(), defaultValue: "" },
            isPrimary: { schema: z.boolean(), defaultValue: false },
        },
    },
    validate: (items$: ReadonlySignal<ContactItem[]>, error: Collect) => {
        const primary = items$().filter((item) => item.fields.isPrimary.value$());
        if (primary.length > 1) error("Only one primary contact");
        if (items$().length > 10) error("At most ten contacts");
    },
};

const tags = {
    item: { schema: z.string().min(1).max(20), defaultValue: "" },
    defaultValue: ["new"],
    validate: (value$: ReadonlySignal<string[]>, warn: Collect) => {
        if (new Set(value$()).size !== value$().length) warn("Duplicate tags");
    },
};

// ==================== Root ====================

type RootValue = {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    confirmPassword: string;
    newsletter: boolean;
    company: CompanyValue & { address: AddressValue };
    billing?: BillingValue;
    contacts: ContactValue[];
    tags: string[];
};
type RootInputs = Inputs<Omit<RootValue, "company" | "billing" | "contacts">> & {
    billing: { fields: Inputs<BillingValue> };
    contacts: { items$: ReadonlySignal<ContactItem[]> };
};
type Context = { tenantId: string; userId: string };

export const RegistrationForm = {
    name: "registration",
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
        fullName: (fields: RootInputs) => `${fields.firstName.value$()} ${fields.lastName.value$()}`,
        contactCount: (fields: RootInputs) => fields.contacts.items$().length,
    },
    queries: {
        plans: (context$: ReadonlySignal<Context>) => getPlans.bind({ tenantId: context$().tenantId }),
        pricing: (fields: RootInputs, contactCount$: ReadonlySignal<number | undefined>) =>
            contactCount$() !== undefined &&
            getPricing.bind({ plan: fields.billing.fields.plan.value$(), seats: fields.contacts.items$().length }),
    },
    validate: {
        passwordsMatch: (fields: RootInputs, error: (node: unknown, message: string) => void) => {
            if (fields.password.value$() !== fields.confirmPassword.value$())
                error(fields.confirmPassword, "Passwords do not match");
        },
        nameOrEmail: (fields: RootInputs, error: Collect) => {
            if (!fields.firstName.value$() && !fields.email.value$()) error("Fill in the name or the email");
        },
        planAvailable: (
            fields: RootInputs,
            plans$: ReadonlySignal<
                TResourceClutchState<{ tenantId: string }, { id: string; price: number }[], ApiError>
            >,
            warn: (node: unknown, message: string) => void,
        ) => {
            const plans = plans$();
            if (plans.hasData && !plans.data.some((p) => p.id === fields.billing.fields.plan.value$()))
                warn(fields.billing, "The plan is not available");
        },
    },
    disabled: {
        billing: (fields: RootInputs, context$: ReadonlySignal<Context>) =>
            fields.newsletter.value$() && context$().tenantId === "",
    },
    submit: (parsed$: ReadonlySignal<{ isParsed: true; value: RootValue }>, context$: ReadonlySignal<Context>) => {
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
};

// ==================== Signal reads ====================

type RootState = { canSubmit: boolean; isSubmitting: boolean };
type NoRetry<S> = S extends unknown ? Omit<S, "retry"> : never;
type FieldState = { visibleErrors: Issue[] };

export function useRegistration(form: {
    state$: ReadonlySignal<RootState>;
    email$: ReadonlySignal<FieldState>;
    emailInfo$: ReadonlySignal<TResourceClutchState<string, { isValid: boolean; isCorporate: boolean }, ApiError>>;
    zipLookup$: ReadonlySignal<TResourceClutchState<{ country: string; zip: string }, { city: string }[], ApiError>>;
    vatCheck$: ReadonlySignal<
        TResourceClutchState<{ country: string; vatId: string }, { valid: boolean; name: string }, ApiError>
    >;
    contacts$: ReadonlySignal<
        (ContactItem & { known$: ReadonlySignal<TResourceClutchState<string, { known: boolean }, ApiError>> })[]
    >;
    submission$: ReadonlySignal<NoRetry<TCommandClutchState<RegistrationArgs, { id: string }, ApiError>> | null>;
    set: (path: string, value: unknown) => void;
    fullName$: ReadonlySignal<string | undefined>;
    oneLine$: ReadonlySignal<string | undefined>;
    billing$: ReadonlySignal<BillingValue | undefined>;
    context$: ReadonlySignal<Context>;
    parsed$: ReadonlySignal<Parsed<RootValue>>;
    submit: () => Promise<boolean>;
}) {
    const root = form.state$();
    const emailState = form.email$();
    const emailInfo = form.emailInfo$();
    const zipCities = form.zipLookup$();
    const vat = form.vatCheck$();
    const firstContact = form.contacts$()[0];
    const submission = form.submission$();

    form.set("email", "a@b.c");
    form.set("company.address.country", "FR");
    form.set("billing.plan", "pro");
    form.set("contacts", [{ name: "Ann", role: "owner" }]);
    form.set("tags", ["vip"]);
    form.set("company", { companyName: "ACME", address: { city: "Berlin" } });
    form.set("context", { tenantId: "t", userId: "u" });
    void form.submit();

    return {
        canSubmit: root.canSubmit && !root.isSubmitting,
        emailError: emailState.visibleErrors[0]?.message,
        corporate: emailInfo.hasData && emailInfo.data.isCorporate,
        cities: zipCities.hasData ? zipCities.data.map((c) => c.city) : [],
        vatName: vat.status === "success" ? vat.data.name : undefined,
        contactName: firstContact?.fields.name.value$(),
        contactKnown: firstContact?.known$().data?.known,
        fullName: form.fullName$(),
        oneLine: form.oneLine$(),
        billingPlan: form.billing$()?.plan,
        submittedId: submission?.status === "success" ? submission.data.id : undefined,
        tenant: form.context$().tenantId,
        parsed: form.parsed$(),
    };
}

export const instance = {
    context: { tenantId: "t", userId: "u" },
    state: { firstName: "Ann", company: { address: { country: "FR" } }, tags: ["a"] },
    key: "registration/1",
};
