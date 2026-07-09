"use server";

import {
  AuditAction,
  type Prisma,
  prisma,
  WhatsAppAccountStatus
} from "@jahf-comm/db";
import { normalizePhoneNumber } from "@jahf-comm/whatsapp";
import { revalidatePath } from "next/cache";

import { getDemoSession } from "@/lib/demo-auth";

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

export async function updateWhatsAppAccountAction(formData: FormData) {
  const { tenant, user } = await getDemoSession();
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
        providerAccountId: nullableString(providerInstanceId || instanceName),
        providerInstanceId: nullableString(providerInstanceId),
        instanceName: nullableString(instanceName)
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
