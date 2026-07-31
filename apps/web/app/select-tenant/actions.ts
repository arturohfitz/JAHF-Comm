"use server";

import { redirect } from "next/navigation";

import { setActiveTenantForSession } from "@/lib/auth";

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

export async function selectTenantAction(formData: FormData) {
  const tenantId = readFormString(formData, "tenantId");

  if (!tenantId) {
    redirect("/select-tenant?error=missing");
  }

  await setActiveTenantForSession(tenantId);

  redirect("/dashboard");
}
