// Resources and commands shared by the type tests.
import { createApi } from "@/query";

import type { IssueInput } from "../../index";

export interface NetError {
    message: string;
}

export const api = createApi({ mapError: (error): NetError => ({ message: String(error) }) });

export interface EmailInfo {
    isValid: boolean;
    isCorporate: boolean;
}

export const getEmailInfo = api.createResource<string, EmailInfo>({
    queryFn: async () => ({ isValid: true, isCorporate: false }),
});
export const getTariffs = api.createResource<"free" | "pro", string[]>({ queryFn: async () => [] });
export const getCities = api.createResource<number, string[]>({ queryFn: async () => [] });

export interface RegistrationArgs {
    name: string;
    email: string;
    services: { tariff: "free" | "pro"; addedServices: string[] };
    phones: { kind: "mobile" | "home"; number: string }[];
}

export const registerCommand = api.createCommand<RegistrationArgs, { id: string }>({
    queryFn: async () => ({ id: "1" }),
});

export function netIssues(error: unknown): IssueInput[] {
    return [{ message: error instanceof Error ? error.message : "Could not submit" }];
}
