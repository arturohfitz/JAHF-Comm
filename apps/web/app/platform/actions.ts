"use server";

import {
  AuditAction,
  MembershipRole,
  NotificationSeverity,
  PlatformRole,
  Prisma,
  prisma
} from "@jahf-comm/db";
import { hashPassword } from "@jahf-comm/shared/passwords";
import { normalizePhoneNumber } from "@jahf-comm/whatsapp";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  clearActiveTenantForSession,
  requirePlatformAdmin,
  setActiveTenantForSession
} from "@/lib/auth";

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function isValidTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function enterTenantAction(formData: FormData) {
  await requirePlatformAdmin();
  const tenantId = readFormString(formData, "tenantId");

  if (!tenantId) {
    throw new Error("Tenant requerido.");
  }

  await setActiveTenantForSession(tenantId);
  redirect("/dashboard");
}

export async function exitTenantAction() {
  await requirePlatformAdmin();
  await clearActiveTenantForSession();
  redirect("/platform");
}

export async function updateTenantNameAction(formData: FormData) {
  await requirePlatformAdmin();
  const tenantId = readFormString(formData, "tenantId");
  const name = readFormString(formData, "name");

  if (!tenantId || !name) {
    throw new Error("Tenant y nombre son requeridos.");
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { name }
  });

  revalidatePath("/platform");
  revalidatePath(`/platform/tenants/${tenantId}`);
}

export async function createTenantOwnerAction(formData: FormData) {
  const session = await requirePlatformAdmin();
  const businessName = readFormString(formData, "businessName");
  const rawSlug = readFormString(formData, "slug") || businessName;
  const slug = normalizeSlug(rawSlug);
  const ownerName = readFormString(formData, "ownerName");
  const ownerEmail = readFormString(formData, "ownerEmail").toLowerCase();
  const temporaryPassword = readFormString(formData, "temporaryPassword");
  const timezone = readFormString(formData, "timezone") || "America/Mexico_City";
  const alertPhone = readFormString(formData, "alertPhone");

  if (!businessName || !slug || !ownerName || !ownerEmail) {
    throw new Error("Completa los datos obligatorios de la empresa y propietario.");
  }

  if (temporaryPassword.length < 12) {
    throw new Error("La contraseña temporal debe tener al menos 12 caracteres.");
  }

  if (!isValidTimezone(timezone)) {
    throw new Error("La zona horaria no es valida.");
  }

  const passwordHash = await hashPassword(temporaryPassword);
  const normalizedAlertPhone = alertPhone ? normalizePhoneNumber(alertPhone) : null;

  const tenant = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const createdTenant = await tx.tenant.create({
      data: {
        name: businessName,
        slug
      },
      select: {
        id: true,
        slug: true
      }
    });
    const owner = await tx.user.create({
      data: {
        email: ownerEmail,
        name: ownerName,
        passwordHash,
        platformRole: PlatformRole.USER,
        mustChangePassword: true,
        emailVerifiedAt: new Date()
      },
      select: {
        id: true
      }
    });

    await tx.membership.create({
      data: {
        tenantId: createdTenant.id,
        userId: owner.id,
        role: MembershipRole.OWNER
      }
    });
    await tx.notificationPreference.create({
      data: {
        tenantId: createdTenant.id,
        userId: owner.id,
        whatsappEnabled: false,
        whatsappPhone: normalizedAlertPhone,
        minimumSeverity: NotificationSeverity.HIGH,
        returningCustomerEnabled: true,
        supportEnabled: true,
        highPriorityEnabled: true,
        negativeSentimentEnabled: false,
        timezone
      }
    });
    await tx.tenantNotificationSettings.create({
      data: {
        tenantId: createdTenant.id,
        whatsappAlertsEnabled: false
      }
    });
    await tx.auditLog.create({
        data: {
          tenantId: createdTenant.id,
          actorUserId: session.user.id,
          action: AuditAction.CREATE,
        entityType: "Tenant",
        entityId: createdTenant.id,
        after: {
          source: "platform-admin",
          ownerUserId: owner.id
        }
      }
    });

    return createdTenant;
  });

  revalidatePath("/platform");
  redirect(`/platform/tenants/${tenant.id}?created=1`);
}
