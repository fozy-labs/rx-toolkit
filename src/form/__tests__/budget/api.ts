// Shared by the type-budget fixture and its form-free twin: the api, its resources and the
// submit command, so their cost cancels out in the delta.
import { createApi } from "@/query";

export interface ApiError {
    message: string;
    issues?: { path: string[]; message: string }[];
}

export const api = createApi({ mapError: (error): ApiError => ({ message: String(error) }) });

export const getEmailInfo = api.createResource<string, { isValid: boolean; isCorporate: boolean }>({
    queryFn: async () => ({ isValid: true, isCorporate: false }),
});
export const getReferral = api.createResource<string, { owner: string } | null>({ queryFn: async () => null });
export const getVat = api.createResource<{ country: string; vatId: string }, { valid: boolean; name: string }>({
    queryFn: async () => ({ valid: true, name: "" }),
});
export const getZip = api.createResource<{ country: string; zip: string }, { city: string }[]>({
    queryFn: async () => [],
});
export const getIban = api.createResource<string, { bank: string; bic: string }>({
    queryFn: async () => ({ bank: "", bic: "" }),
});
export const getPlans = api.createResource<{ tenantId: string }, { id: string; price: number }[]>({
    queryFn: async () => [],
});
export const getIndustries = api.createResource<"small" | "medium" | "large", string[]>({ queryFn: async () => [] });
export const getRegions = api.createResource<string, string[]>({ queryFn: async () => [] });
export const getPricing = api.createResource<{ plan: "free" | "pro" | "enterprise"; seats: number }, { total: number }>(
    { queryFn: async () => ({ total: 0 }) },
);
export const getContactInfo = api.createResource<string, { known: boolean }>({
    queryFn: async () => ({ known: false }),
});

export interface RegistrationArgs {
    firstName: string;
    lastName: string;
    email: string;
    company: { companyName: string; vatId?: string };
    billing?: { iban: string; plan: "free" | "pro" | "enterprise" };
    contacts: { name: string; email: string }[];
    tags: string[];
}

export const register = api.createCommand<RegistrationArgs, { id: string }>({ queryFn: async () => ({ id: "1" }) });
