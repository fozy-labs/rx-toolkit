import type { SKIP_TOKEN } from "../lib/SKIP_TOKEN";

/** Makes args optional when TArgs = void */
export type ArgsOrVoid<TArgs> = TArgs extends void ? [] : [args: TArgs];

/** Extends ArgsOrVoid to accept SKIP token */
export type ArgsOrVoidOrSkip<TArgs> = TArgs extends void ? ([] | [args: SKIP_TOKEN | TArgs])  : [args: TArgs | SKIP_TOKEN];

/** Flatten intersection types into a readable shape */
export type Prettify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

/** Convert a union type to an intersection type */
export type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
