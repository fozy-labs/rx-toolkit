// @vitest-environment node
// "React", SSR: a form renders on the server with the values of its `state`.
import React from "react";
import { renderToString } from "react-dom/server";
import { z } from "zod";

import { createApi } from "@/query";
import { useSignal } from "@/signals";

import { unstable_FormSignal as FormSignal, unstable_formsReactPlugin } from "../../index";

const h = React.createElement;

describe("SSR", () => {
    it("renders a form on the server", () => {
        const api = createApi({ plugins: [unstable_formsReactPlugin()] });
        const Profile = api.defineForm({
            fields: { name: FormSignal.field({ schema: z.string(), defaultValue: "" }) },
        });
        function Editor() {
            const form = Profile.useForm({ state: { name: "Ann" } });
            const name = useSignal(form.fields.name$);
            return h("input", { value: name.value, readOnly: true });
        }
        expect(renderToString(h(Editor))).toContain('value="Ann"');
    });
});
