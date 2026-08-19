"use server";

import {
  AuditAction,
  MembershipRole,
  NotificationSeverity,
  Prisma,
  prisma,
  WhatsAppAccountStatus,
  WhatsAppProvider
} from "@jahf-comm/db";
import { normalizePhoneNumber } from "@jahf-comm/whatsapp";
import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth";

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function readFormBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function isValidTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function parseSeverity(value: string) {
  if (Object.values(NotificationSeverity).includes(value as NotificationSeverity)) {
    return value as NotificationSeverity;
  }

  return NotificationSeverity.HIGH;
}

async function assertNoGlobalIdentityConflict(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    provider: WhatsAppProvider;
    instanceName: string;
    providerInstanceId: string | null;
    providerAccountId: string | null;
    excludeAccountId?: string;
  }
) {
  const or: Prisma.WhatsAppAccountWhereInput[] = [
    { instanceName: input.instanceName }
  ];

  if (input.providerInstanceId) {
    or.push({ providerInstanceId: input.providerInstanceId });
  }

  if (input.providerAccountId) {
    or.push({ providerAccountId: input.providerAccountId });
  }

  const existing = await tx.whatsAppAccount.findFirst({
    where: {
      provider: input.provider,
      id: input.excludeAccountId ? { not: input.excludeAccountId } : undefined,
      OR: or
    },
    select: {
      tenantId: true
    }
  });

  if (existing && existing.tenantId !== input.tenantId) {
    throw new Error("La identidad Evolution ya esta configurada en otro tenant.");
  }
}

export async function completeOnboardingAction(formData: FormData) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (!session.tenant || !session.membership) {
    redirect("/select-tenant");
  }

  if (session.membership.role !== MembershipRole.OWNER) {
    throw new Error("Solo el propietario puede completar el onboarding.");
  }

  const tenant = session.tenant;
  const tenantName = readFormString(formData, "tenantName");
  const timezone = readFormString(formData, "timezone") || "America/Mexico_City";
  const displayName = readFormString(formData, "displayName");
  const commercialPhone = readFormString(formData, "commercialPhone");
  const instanceName = readFormString(formData, "instanceName");
  const providerInstanceId =
    readFormString(formData, "providerInstanceId") || instanceName;
  const providerAccountId =
    readFormString(formData, "providerAccountId") || providerInstanceId;
  const personalPhone = readFormString(formData, "personalPhone");

  if (!tenantName || !displayName || !commercialPhone || !instanceName) {
    throw new Error("Completa empresa, WhatsApp comercial e instanceName.");
  }

  if (!isValidTimezone(timezone)) {
    throw new Error("La zona horaria no es valida.");
  }

  const normalizedCommercialPhone = normalizePhoneNumber(commercialPhone);
  const normalizedPersonalPhone = personalPhone
    ? normalizePhoneNumber(personalPhone)
    : null;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const currentAccount = await tx.whatsAppAccount.findFirst({
      where: {
        tenantId: tenant.id,
        provider: WhatsAppProvider.EVOLUTION
      },
      orderBy: { createdAt: "asc" },
      select: { id: true }
    });

    await assertNoGlobalIdentityConflict(tx, {
      tenantId: tenant.id,
      provider: WhatsAppProvider.EVOLUTION,
      instanceName,
      providerInstanceId,
      providerAccountId,
      excludeAccountId: currentAccount?.id
    });

    const account = currentAccount
      ? await tx.whatsAppAccount.update({
          where: {
            tenantId_id: {
              tenantId: tenant.id,
              id: currentAccount.id
            }
          },
          data: {
            name: displayName,
            displayName,
            phoneNumber: commercialPhone,
            normalizedPhoneNumber: normalizedCommercialPhone,
            provider: WhatsAppProvider.EVOLUTION,
            status: WhatsAppAccountStatus.PENDING,
            instanceName,
            providerInstanceId,
            providerAccountId
          },
          select: { id: true }
        })
      : await tx.whatsAppAccount.create({
          data: {
            tenantId: tenant.id,
            name: displayName,
            displayName,
            phoneNumber: commercialPhone,
            normalizedPhoneNumber: normalizedCommercialPhone,
            provider: WhatsAppProvider.EVOLUTION,
            status: WhatsAppAccountStatus.PENDING,
            instanceName,
            providerInstanceId,
            providerAccountId
          },
          select: { id: true }
        });

    await tx.notificationPreference.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: session.user.id
        }
      },
      update: {
        whatsappEnabled: readFormBoolean(formData, "whatsappEnabled"),
        whatsappPhone: normalizedPersonalPhone,
        minimumSeverity: parseSeverity(readFormString(formData, "minimumSeverity")),
        returningCustomerEnabled: readFormBoolean(
          formData,
          "returningCustomerEnabled"
        ),
        supportEnabled: readFormBoolean(formData, "supportEnabled"),
        highPriorityEnabled: readFormBoolean(formData, "highPriorityEnabled"),
        negativeSentimentEnabled: readFormBoolean(
          formData,
          "negativeSentimentEnabled"
        ),
        timezone
      },
      create: {
        tenantId: tenant.id,
        userId: session.user.id,
        whatsappEnabled: readFormBoolean(formData, "whatsappEnabled"),
        whatsappPhone: normalizedPersonalPhone,
        minimumSeverity: parseSeverity(readFormString(formData, "minimumSeverity")),
        returningCustomerEnabled: readFormBoolean(
          formData,
          "returningCustomerEnabled"
        ),
        supportEnabled: readFormBoolean(formData, "supportEnabled"),
        highPriorityEnabled: readFormBoolean(formData, "highPriorityEnabled"),
        negativeSentimentEnabled: readFormBoolean(
          formData,
          "negativeSentimentEnabled"
        ),
        timezone
      }
    });
    await tx.tenantNotificationSettings.upsert({
      where: { tenantId: tenant.id },
      update: {
        whatsappAlertsEnabled: false,
        whatsappAlertsAccountId: account.id
      },
      create: {
        tenantId: tenant.id,
        whatsappAlertsEnabled: false,
        whatsappAlertsAccountId: account.id
      }
    });
    await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        name: tenantName,
        onboardingCompletedAt: new Date()
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: session.user.id,
        action: AuditAction.UPDATE,
        entityType: "TenantOnboarding",
        entityId: tenant.id,
        after: {
          source: "owner-onboarding",
          whatsappAccountId: account.id,
          whatsappAlertsEnabled: false
        }
      }
    });
  });

  redirect("/settings");
}
