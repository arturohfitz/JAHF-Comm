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
import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth";

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: string) {
  return value.length > 0 ? value : null;
}

function readFormBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function parseNotificationSeverity(value: string) {
  if (
    Object.values(NotificationSeverity).includes(value as NotificationSeverity)
  ) {
    return value as NotificationSeverity;
  }

  throw new Error("Severidad minima no valida.");
}

function isValidTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function isValidHHmm(value: string) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function parseStatus(value: string) {
  if (
    Object.values(WhatsAppAccountStatus).includes(
      value as WhatsAppAccountStatus
    )
  ) {
    return value as WhatsAppAccountStatus;
  }

  throw new Error("Estatus de WhatsApp no valido.");
}

function parseProvider(value: string) {
  if (Object.values(WhatsAppProvider).includes(value as WhatsAppProvider)) {
    return value as WhatsAppProvider;
  }

  throw new Error("Proveedor de WhatsApp no valido.");
}

function normalizeInstanceInput(input: {
  provider: WhatsAppProvider;
  instanceName: string;
  providerInstanceId: string;
}) {
  const instanceName = input.instanceName.trim();
  const providerInstanceId =
    input.providerInstanceId.trim() || (instanceName ? instanceName : "");

  if (input.provider === WhatsAppProvider.EVOLUTION && !instanceName) {
    throw new Error("El instanceName es requerido para Evolution API.");
  }

  return {
    instanceName: nullableString(instanceName),
    providerAccountId: nullableString(providerInstanceId || instanceName),
    providerInstanceId: nullableString(providerInstanceId)
  };
}

async function assertUniqueWhatsAppAccount(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    provider: WhatsAppProvider;
    normalizedPhoneNumber: string;
    instanceName: string | null;
    providerInstanceId: string | null;
    excludeAccountId?: string;
  }
) {
  const orFilters: Prisma.WhatsAppAccountWhereInput[] = [
    { normalizedPhoneNumber: input.normalizedPhoneNumber }
  ];

  if (input.instanceName) {
    orFilters.push({
      provider: input.provider,
      instanceName: input.instanceName
    });
  }

  if (input.providerInstanceId) {
    orFilters.push({
      provider: input.provider,
      providerInstanceId: input.providerInstanceId
    });
  }

  const account = await tx.whatsAppAccount.findFirst({
    where: {
      tenantId: input.tenantId,
      id: input.excludeAccountId ? { not: input.excludeAccountId } : undefined,
      OR: orFilters
    },
    select: { id: true }
  });

  if (account) {
    throw new Error(
      "Ya existe una cuenta WhatsApp con el mismo telefono, instanceName o providerInstanceId en este tenant."
    );
  }
}

export async function createWhatsAppAccount(formData: FormData) {
  const { tenant, user } = await requireRole([
    MembershipRole.OWNER,
    MembershipRole.ADMIN
  ]);
  const displayName = readFormString(formData, "displayName");
  const phoneNumber = readFormString(formData, "phoneNumber");
  const provider = parseProvider(
    readFormString(formData, "provider") || WhatsAppProvider.EVOLUTION
  );
  const status = parseStatus(
    readFormString(formData, "status") || WhatsAppAccountStatus.PENDING
  );
  const instance = normalizeInstanceInput({
    provider,
    instanceName: readFormString(formData, "instanceName"),
    providerInstanceId: readFormString(formData, "providerInstanceId")
  });

  if (!displayName) {
    throw new Error("El nombre visible es requerido.");
  }

  if (!phoneNumber) {
    throw new Error("El telefono es requerido.");
  }

  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  await prisma.$transaction(async (tx) => {
    await assertUniqueWhatsAppAccount(tx, {
      tenantId: tenant.id,
      provider,
      normalizedPhoneNumber,
      instanceName: instance.instanceName,
      providerInstanceId: instance.providerInstanceId
    });

    const account = await tx.whatsAppAccount.create({
      data: {
        tenantId: tenant.id,
        name: displayName,
        displayName,
        phoneNumber,
        normalizedPhoneNumber,
        provider,
        status,
        providerAccountId: instance.providerAccountId,
        providerInstanceId: instance.providerInstanceId,
        instanceName: instance.instanceName
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        phoneNumber: true,
        normalizedPhoneNumber: true,
        provider: true,
        status: true,
        providerAccountId: true,
        providerInstanceId: true,
        instanceName: true
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: AuditAction.CREATE,
        entityType: "WhatsAppAccount",
        entityId: account.id,
        before: Prisma.JsonNull,
        after: account as Prisma.InputJsonValue
      }
    });
  });

  revalidatePath("/settings");
  revalidatePath("/settings/whatsapp");
}

export async function updateWhatsAppAccountAction(formData: FormData) {
  const { tenant, user } = await requireRole([
    MembershipRole.OWNER,
    MembershipRole.ADMIN
  ]);
  const accountId = readFormString(formData, "accountId");
  const displayName = readFormString(formData, "displayName");
  const phoneNumber = readFormString(formData, "phoneNumber");
  const providerInstanceId = readFormString(formData, "providerInstanceId");
  const instanceName = readFormString(formData, "instanceName");
  const status = parseStatus(readFormString(formData, "status"));

  if (!accountId) {
    throw new Error("Cuenta WhatsApp requerida.");
  }

  if (!displayName) {
    throw new Error("El nombre visible es requerido.");
  }

  if (!phoneNumber) {
    throw new Error("El telefono es requerido.");
  }

  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  await prisma.$transaction(async (tx) => {
    const current = await tx.whatsAppAccount.findFirstOrThrow({
      where: {
        id: accountId,
        tenantId: tenant.id
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        phoneNumber: true,
        normalizedPhoneNumber: true,
        provider: true,
        status: true,
        providerAccountId: true,
        providerInstanceId: true,
        instanceName: true
      }
    });
    const instance = normalizeInstanceInput({
      provider: current.provider,
      instanceName,
      providerInstanceId
    });

    await assertUniqueWhatsAppAccount(tx, {
      tenantId: tenant.id,
      provider: current.provider,
      normalizedPhoneNumber,
      instanceName: instance.instanceName,
      providerInstanceId: instance.providerInstanceId,
      excludeAccountId: accountId
    });

    const after = await tx.whatsAppAccount.update({
      where: {
        tenantId_id: {
          tenantId: tenant.id,
          id: accountId
        }
      },
      data: {
        name: displayName,
        displayName,
        phoneNumber,
        normalizedPhoneNumber,
        status,
        providerAccountId: instance.providerAccountId,
        providerInstanceId: instance.providerInstanceId,
        instanceName: instance.instanceName
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        phoneNumber: true,
        normalizedPhoneNumber: true,
        provider: true,
        status: true,
        providerAccountId: true,
        providerInstanceId: true,
        instanceName: true
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: AuditAction.UPDATE,
        entityType: "WhatsAppAccount",
        entityId: accountId,
        before: current as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue
      }
    });
  });

  revalidatePath("/settings");
  revalidatePath("/settings/whatsapp");
}

export async function disconnectWhatsAppAccountAction(formData: FormData) {
  const { tenant, user } = await requireRole([
    MembershipRole.OWNER,
    MembershipRole.ADMIN
  ]);
  const accountId = readFormString(formData, "accountId");

  if (!accountId) {
    throw new Error("Cuenta WhatsApp requerida.");
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.whatsAppAccount.findFirstOrThrow({
      where: {
        id: accountId,
        tenantId: tenant.id
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        phoneNumber: true,
        normalizedPhoneNumber: true,
        provider: true,
        status: true,
        providerAccountId: true,
        providerInstanceId: true,
        instanceName: true
      }
    });

    const after = await tx.whatsAppAccount.update({
      where: {
        tenantId_id: {
          tenantId: tenant.id,
          id: accountId
        }
      },
      data: {
        status: WhatsAppAccountStatus.DISCONNECTED
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        phoneNumber: true,
        normalizedPhoneNumber: true,
        provider: true,
        status: true,
        providerAccountId: true,
        providerInstanceId: true,
        instanceName: true
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: AuditAction.STATUS_CHANGE,
        entityType: "WhatsAppAccount",
        entityId: accountId,
        before: current as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue
      }
    });
  });

  revalidatePath("/settings");
  revalidatePath("/settings/whatsapp");
}

export async function updateTenantWhatsappAlertSettingsAction(
  formData: FormData
) {
  const { tenant, user } = await requireRole([
    MembershipRole.OWNER,
    MembershipRole.ADMIN
  ]);
  const whatsappAccountId = nullableString(
    readFormString(formData, "whatsappAlertsAccountId")
  );
  const whatsappAlertsEnabled = readFormBoolean(
    formData,
    "whatsappAlertsEnabled"
  );

  if (whatsappAccountId) {
    const account = await prisma.whatsAppAccount.findFirst({
      where: {
        id: whatsappAccountId,
        tenantId: tenant.id,
        status: {
          in: [WhatsAppAccountStatus.CONNECTED, WhatsAppAccountStatus.PENDING]
        }
      },
      select: { id: true }
    });

    if (!account) {
      throw new Error("La cuenta WhatsApp no pertenece a este tenant.");
    }
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.tenantNotificationSettings.findUnique({
      where: { tenantId: tenant.id }
    });
    const after = await tx.tenantNotificationSettings.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        whatsappAlertsAccountId: whatsappAccountId,
        whatsappAlertsEnabled
      },
      update: {
        whatsappAlertsAccountId: whatsappAccountId,
        whatsappAlertsEnabled
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: before ? AuditAction.UPDATE : AuditAction.CREATE,
        entityType: "TenantNotificationSettings",
        entityId: after.id,
        before: before ? (before as Prisma.InputJsonValue) : Prisma.JsonNull,
        after: after as Prisma.InputJsonValue
      }
    });
  });

  revalidatePath("/settings");
  revalidatePath("/settings/whatsapp");
}

export async function updateMyWhatsappNotificationPreferenceAction(
  formData: FormData
) {
  const { tenant, user, membership } = await requireRole([
    MembershipRole.OWNER,
    MembershipRole.ADMIN,
    MembershipRole.AGENT,
    MembershipRole.VIEWER
  ]);
  const whatsappPhone = nullableString(readFormString(formData, "whatsappPhone"));
  const quietHoursEnabled = readFormBoolean(formData, "quietHoursEnabled");
  const whatsappEnabled = readFormBoolean(formData, "whatsappEnabled");
  const timezone = readFormString(formData, "timezone") || "UTC";
  const quietHoursStart = quietHoursEnabled
    ? nullableString(readFormString(formData, "quietHoursStart"))
    : null;
  const quietHoursEnd = quietHoursEnabled
    ? nullableString(readFormString(formData, "quietHoursEnd"))
    : null;

  if (whatsappEnabled && membership.role === MembershipRole.VIEWER) {
    throw new Error("VIEWER no puede activar alertas por WhatsApp.");
  }

  if (!isValidTimezone(timezone)) {
    throw new Error("Zona horaria no valida.");
  }

  if (quietHoursEnabled) {
    if (!quietHoursStart || !quietHoursEnd) {
      throw new Error("El horario silencioso requiere inicio y fin.");
    }

    if (!isValidHHmm(quietHoursStart) || !isValidHHmm(quietHoursEnd)) {
      throw new Error("El horario silencioso debe usar formato HH:mm.");
    }
  }

  await prisma.notificationPreference.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id
      }
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      whatsappPhone: whatsappPhone ? normalizePhoneNumber(whatsappPhone) : null,
      whatsappEnabled,
      minimumSeverity: parseNotificationSeverity(
        readFormString(formData, "minimumSeverity") || NotificationSeverity.HIGH
      ),
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
      quietHoursEnabled,
      quietHoursStart,
      quietHoursEnd,
      timezone,
      allowUrgentDuringQuietHours: readFormBoolean(
        formData,
        "allowUrgentDuringQuietHours"
      )
    },
    update: {
      whatsappPhone: whatsappPhone ? normalizePhoneNumber(whatsappPhone) : null,
      whatsappEnabled,
      minimumSeverity: parseNotificationSeverity(
        readFormString(formData, "minimumSeverity") || NotificationSeverity.HIGH
      ),
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
      quietHoursEnabled,
      quietHoursStart,
      quietHoursEnd,
      timezone,
      allowUrgentDuringQuietHours: readFormBoolean(
        formData,
        "allowUrgentDuringQuietHours"
      )
    }
  });

  revalidatePath("/settings");
  revalidatePath("/settings/whatsapp");
}
