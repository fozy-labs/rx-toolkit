import type { AnyDef, AnyGroupDef } from "./definition";

/** The node type of a definition. */
export type FormNode<D extends AnyDef> = D["__node"];

/** The instance type of a root definition. */
export type FormInstance<D extends AnyGroupDef> = D["__instance"];

/** The starting values: a field takes its whole input, a group any subset of keys, a list an array. */
export type FormInitial<D extends AnyDef> = D["__initial"];

/** The value of a definition: the schema inputs, what is edited. */
export type FormInput<D extends AnyDef> = D["__input"];

/** The parsed value of a definition: the schema outputs. */
export type FormOutput<D extends AnyDef> = D["__output"];

/** The context an instance of the definition must be given; `unknown` when nothing reads one. */
export type FormContext<D extends AnyDef> = D["__context"];

/**
 * What `FormSignal.state(def, init)` accepts. `context` is required once the definition declares
 * a context requirement.
 */
export type FormInit<D extends AnyGroupDef> = {
    state?: FormInitial<D>;
    key?: string;
} & (unknown extends FormContext<D> ? { context?: FormContext<D> } : { context: FormContext<D> });

/** The `init` parameter of `FormSignal.state` / `useForm`: optional unless a context is required. */
export type FormInitArgs<D extends AnyGroupDef> =
    unknown extends FormContext<D> ? [init?: FormInit<D>] : [init: FormInit<D>];
