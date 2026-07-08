export const APP_NAME = "JAHF Comm";

export type TenantId = string & { readonly __brand: "TenantId" };

export type TenantScoped = {
  tenantId: string;
};
