import type { DefinitionRecord } from "../definition/records";

import { FieldCore } from "./FieldCore";
import { GroupCore } from "./GroupCore";
import { ListCore } from "./ListCore";
import type { NodeCore, ParentCore } from "./NodeCore";

/** Creates the core of a child definition; `initial` is its starting value or `ABSENT`. */
export function buildNode(record: DefinitionRecord, parent: ParentCore, name: string, initial: unknown): NodeCore {
    switch (record.kind) {
        case "field":
            return new FieldCore(record, parent, name, initial);
        case "group":
            return new GroupCore(record, parent, name, initial);
        case "list":
            return new ListCore(record, parent, name, initial);
    }
}
