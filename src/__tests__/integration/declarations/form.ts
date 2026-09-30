// A consumer of the forms module: every export is left to inference, so its declaration names
// the form's types. `declarations.test.ts` compiles it against the built package, with `@/index`
// replaced by the package name.
import {
    createApi,
    unstable_FormSignal as FormSignal,
    unstable_formsPlugin,
    unstable_formsReactPlugin,
    type StandardSchemaV1,
} from "@/index";

function schema<T>(check: (value: unknown) => value is T): StandardSchemaV1<T, T> {
    return {
        "~standard": {
            version: 1,
            vendor: "consumer",
            validate: (value) => (check(value) ? { value } : { issues: [{ message: "Invalid" }] }),
        },
    } as StandardSchemaV1<T, T>;
}

const text = schema((value): value is string => typeof value === "string");
const flag = schema((value): value is boolean => typeof value === "boolean");

export const api = createApi({
    plugins: [unstable_formsPlugin({ mapSubmitError: (error: { message: string }) => [{ message: error.message }] })],
    mapError: (error) => ({ message: String(error) }),
});

export const getInfo = api.createResource<string, { taken: boolean }>({ queryFn: async () => ({ taken: false }) });

export const save = api.createCommand<{ email: string; phones: { number: string }[] }, { id: string }>({
    queryFn: async () => ({ id: "1" }),
});

export const email = FormSignal.field({
    schema: text,
    defaultValue: "",
    queries: { info: { bind: ({ value$ }) => getInfo.bind(value$()), debounce: 300 } },
    validate: ({ queries, error }) => {
        const info = queries.info$();
        if (info.dataSource === "current" && info.data.taken) error("Taken");
    },
});

export const phones = FormSignal.list({
    item: FormSignal.group({ fields: { number: FormSignal.field({ schema: text, defaultValue: "" }) } }),
    validate: ({ items$, error }) => {
        if (items$().length > 3) error("At most three");
    },
});

export const Profile = api.defineForm({
    name: "profile",
    fields: { email, phones, company: FormSignal.field({ schema: flag, defaultValue: false }) },
    context: FormSignal.context<{ id: string }>(),
    computed: { title: ({ fields }) => fields.email.value$().toUpperCase() },
    disabled: { phones: ({ fields }) => fields.company.value$() },
    submit: ({ parsed$ }) => save.bind({ email: parsed$().value.email, phones: parsed$().value.phones ?? [] }),
    mapSubmitError: (error) => [{ message: error.message }],
});

export const Draft = FormSignal.group({
    fields: { note: FormSignal.field({ schema: text, defaultValue: "" }) },
    submit: () => Promise.resolve(1),
});

export const form = FormSignal.state(Profile, { context: { id: "1" } });
export const rows = form.fields.phones.items$();
export const row = form.fields.phones.push();
export const submission = form.submission$();
export const info = form.fields.email.queries.info$();
export const state = form.state$();
export const title = form.computed.title$;

export function createDraft() {
    return FormSignal.state(Draft);
}

export const reactApi = createApi({ plugins: [unstable_formsReactPlugin()] });

export const Note = reactApi.defineForm({
    fields: { note: FormSignal.field({ schema: text, defaultValue: "" }) },
    context: FormSignal.context<{ id: string }>(),
});

export function useNote() {
    return Note.useForm({ context: { id: "1" } });
}

export function useNoteContext() {
    return Note.useFormContext();
}
