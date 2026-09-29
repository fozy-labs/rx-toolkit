import { FormConfigError } from "../FormConfigError";

import { assertOptions, checkContext, checkRules, checkShowErrors, describeValue } from "./checks";
import { assertChild } from "./createGroupDef";
import { registerDefinition, type ListRecord } from "./records";

const LIST_OPTIONS = ["item", "defaultValue", "showErrors", "context", "validate"] as const;

export function createListDef(input: unknown): ListRecord {
    const options = assertOptions(input, LIST_OPTIONS, "list");
    const item = assertChild(options.item, "item");
    if (item.kind === "list") {
        throw new FormConfigError("item", "a list item must be a field or a group, not a list");
    }
    const defaultValue = options.defaultValue ?? [];
    if (!Array.isArray(defaultValue)) {
        throw new FormConfigError("defaultValue", `must be an array (got ${describeValue(defaultValue)})`);
    }
    return registerDefinition<ListRecord>({
        kind: "list",
        item,
        defaultValue: Object.freeze([...defaultValue]),
        showErrors: checkShowErrors(options.showErrors, "showErrors"),
        hasContext: checkContext(options.context, "context"),
        rules: checkRules(options.validate, "validate"),
    });
}
