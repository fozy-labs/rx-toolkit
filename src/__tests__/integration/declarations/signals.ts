// A consumer of the signals module: every export is left to inference, so its declaration
// names the proxy path-node types and the GC options. `declarations.test.ts` compiles it
// against the built package, with `@/index` replaced by the package name.
import { LocalSignal, unstable_ProxySignal as ProxySignal } from "@/index";

export const profile = ProxySignal.state({ user: { name: "Ann", tags: [] as string[] } });

// Path nodes: their types expand the `PathNode` alias, so the call shapes it is built
// from must be inlinable — a named but unnameable shape breaks the emit (TS4023).
export const nameNode = profile.root.user.name;
export const firstTag = profile.root.user.tags[0];

export function readName(node: typeof nameNode): string {
    return node();
}

export const gc = LocalSignal.GC_OPTIONS;
