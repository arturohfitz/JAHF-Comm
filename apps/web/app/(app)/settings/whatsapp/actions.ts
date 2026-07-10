"use server";

import {
  AuditAction,
  MembershipRole,
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
