import {
  MembershipRole,
  WhatsAppAccountStatus,
  prisma
} from "./index.js";

const settingsRoles = [MembershipRole.OWNER, MembershipRole.ADMIN] as const;

async function requireTenantNotificationSettingsRole(input: {
  tenantId: string;
  actorUserId: string;
}) {
  const membership = await prisma.membership.findFirst({
    where: {
      tenantId: input.tenantId,
      userId: input.actorUserId,
      role: {
        in: [...settingsRoles]
      }
    },
    select: {
      id: true
    }
  });

  if (!membership) {
    throw new Error("Only OWNER and ADMIN users can manage notification settings.");
  }
}

export async function getTenantNotificationSettings(input: { tenantId: string }) {
  return prisma.tenantNotificationSettings.findUnique({
    where: {
      tenantId: input.tenantId
    },
    include: {
      whatsappAlertsAccount: true
    }
  });
}

export async function setTenantWhatsappAlertsAccount(input: {
  tenantId: string;
  actorUserId: string;
  whatsappAccountId: string | null;
  whatsappAlertsEnabled?: boolean;
}) {
  await requireTenantNotificationSettingsRole(input);

  if (input.whatsappAccountId) {
    const account = await prisma.whatsAppAccount.findFirst({
      where: {
        id: input.whatsappAccountId,
        tenantId: input.tenantId,
        status: {
          in: [WhatsAppAccountStatus.CONNECTED, WhatsAppAccountStatus.PENDING]
        }
      },
      select: {
        id: true
      }
    });

    if (!account) {
      throw new Error("WhatsApp account does not belong to this tenant.");
    }
  }

  return prisma.tenantNotificationSettings.upsert({
    where: {
      tenantId: input.tenantId
    },
    create: {
      tenantId: input.tenantId,
      whatsappAlertsAccountId: input.whatsappAccountId,
      whatsappAlertsEnabled: input.whatsappAlertsEnabled ?? false
    },
    update: {
      whatsappAlertsAccountId: input.whatsappAccountId,
      whatsappAlertsEnabled: input.whatsappAlertsEnabled
    }
  });
}
