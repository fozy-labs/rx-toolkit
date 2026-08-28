/**
 * Directive bodies are checked and analysed as TypeScript in the same
 * wrapping the emitter uses, so that what passes the syntax check is exactly
 * what ends up in the generated file. The body always starts on the second
 * line of the wrapped text, which keeps line / column mapping trivial.
 */
export type BodyKind = "expression" | "statements" | "type";

export interface WrappedBody {
    text: string;
    /** 0-based line of the wrapped text where the body starts. */
    bodyLineOffset: number;
}

export function wrapBody(body: string, kind: BodyKind): WrappedBody {
    switch (kind) {
        case "expression":
            return { text: `(context, event) => (\n${body}\n)`, bodyLineOffset: 1 };
        case "statements":
            return { text: `(context, event) => {\n${body}\n}`, bodyLineOffset: 1 };
        case "type":
            return { text: `type T =\n${body}\n;`, bodyLineOffset: 1 };
    }
}
