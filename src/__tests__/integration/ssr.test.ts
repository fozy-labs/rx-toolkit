// The SSR scenario from docs/query/usage/snapshot.md: the server preloads the
// cache, renders it and ships a snapshot; the client hydrates the same tree
// from that snapshot without a mismatch.
import { act } from "@testing-library/react";
import React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { createApi } from "@/query/api/createApi";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type { TApiSnapshot } from "@/query/types";

const h = React.createElement;

type TUser = { id: number; name: string };

function createSetup(initialSnapshot?: TApiSnapshot) {
    const api = createApi({ plugins: [reactHooksPlugin()], initialSnapshot });
    const queryFn = vi.fn(async ({ id }: { id: number }) => ({ id, name: `user-${id}` }));
    const user = api.createResource<{ id: number }, TUser>({ key: "user", queryFn });
    return { api, user, queryFn };
}

type Setup = ReturnType<typeof createSetup>;

function ResourceProfile({ user }: { user: Setup["user"] }) {
    const { data, status } = user.useResource({ id: 1 });
    return h("p", null, data ? data.name : status);
}

function SuspenseProfile({ user }: { user: Setup["user"] }) {
    const { data } = user.useSuspenseResource({ id: 1 });
    return h("p", null, data.name);
}

function SuspenseApp({ user }: { user: Setup["user"] }) {
    return h(React.Suspense, { fallback: h("p", null, "loading") }, h(SuspenseProfile, { user }));
}

describe("SSR with a snapshot", () => {
    it.each([
        ["useResource", ResourceProfile],
        ["useSuspenseResource", SuspenseApp],
    ] as const)("%s renders on the server and hydrates without a mismatch", async (_, App) => {
        const server = createSetup();
        await server.user.ensure({ id: 1 });
        const html = renderToString(h(App, { user: server.user }));
        const snapshot = JSON.parse(JSON.stringify(server.api.getSnapshot())) as TApiSnapshot;
        expect(html).toContain("user-1");

        const container = document.createElement("div");
        container.innerHTML = html;
        const client = createSetup(snapshot);
        const onRecoverableError = vi.fn();

        await act(async () => {
            hydrateRoot(container, h(App, { user: client.user }), { onRecoverableError });
        });

        expect(onRecoverableError).not.toHaveBeenCalled();
        expect(container.textContent).toBe("user-1");
        expect(client.queryFn).not.toHaveBeenCalled();
    });
});
