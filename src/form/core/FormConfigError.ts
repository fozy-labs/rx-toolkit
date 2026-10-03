/**
 * Thrown for an invalid form definition: by `field()` / `group()` / `list()` when a definition is
 * created, and later by the instance for configuration errors found during a computation.
 *
 * `path` is the option path of the problem relative to the definition being created
 * (`"fields.email$"`, `"queries.emailInfo"`); the definition itself is `""`. The message is
 * `"<path>: <detail>"`, or just `"<detail>"` for the definition itself.
 */
export class FormConfigError extends Error {
    override readonly name = "FormConfigError";
    readonly path: string;
    readonly detail: string;

    constructor(path: string, detail: string) {
        super(path ? `${path}: ${detail}` : detail);
        this.path = path;
        this.detail = detail;
    }
}
