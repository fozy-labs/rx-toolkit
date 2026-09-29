// @vitest-environment node
// "React", SSR: the form reads its signals through `useSignal`, which has no
// `getServerSnapshot`, so rendering a form on the server throws; its subtree must be client-only.
import React from "react";
import { renderToString } from "react-dom/server";
import { z } from "zod";

import { createApi } from "@/query";
import { useSignal } from "@/signals";

import { unstable_FormSignal as FormSignal, unstable_formsReactPlugin } from "../../index";

const h = React.createElement;

describe("SSR", () => {
    it("rendering a form on the server throws Missing getServerSnapshot", () => {
        const api = createApi({ plugins: [unstable_formsReactPlugin()] });
        const Profile = api.defineForm({
            fields: { name: FormSignal.field({ schema: z.string(), defaultValue: "" }) },
        });
        function Editor() {
            const form = Profile.useForm({ state: { name: "Ann" } });
            const name = useSignal(form.fields.name$);
            return h("input", { value: name.value, readOnly: true });
        }
        expect(() => renderToString(h(Editor))).toThrow(/Missing getServerSnapshot/);
    });
});
