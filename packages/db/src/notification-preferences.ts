import {
  MembershipRole,
  NotificationSeverity,
  Prisma,
  prisma
} from "./index.js";

export type UpsertNotificationPreferenceInput = {
  inAppEnabled?: boolean;
  whatsappEnabled?: boolean;
  whatsappPhone?: string | null;
  minimumSeverity?: NotificationSeverity;
  returningCustomerEnabled?: boolean;
  supportEnabled?: boolean;
  highPriorityEnabled?: boolean;
  negativeSentimentEnabled?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  timezone?: string;
  allowUrgentDuringQuietHours?: boolean;
};

export function isValidTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isValidHHmm(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  return Boolean(match);
}

export function normalizeInternalWhatsappPhone(value: string) {
  const normalized = value.replace(/[^\d+]/g, "");

  if (!/^\+?\d{8,15}$/.test(normalized)) {
    throw new Error("Invalid WhatsApp phone number.");
  }

  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

export async function validateNotificationPreferenceAccess(input: {
  tenantId: string;
  userId: string;
}) {
  const membership = await prisma.membership.findFirst({
    where: {
      tenantId: input.tenantId,
      userId: input.userId
    },
    select: {
      role: true
    }
  });

  if (!membership) {
    throw new Error("User is not a member of this tenant.");
  }

  return membership;
}

function buildPreferenceData(input: UpsertNotificationPreferenceInput) {
  const data: Partial<
    Pick<
      Prisma.NotificationPreferenceUncheckedCreateInput,
      | "inAppEnabled"
      | "whatsappEnabled"
      | "whatsappPhone"
      | "minimumSeverity"
      | "returningCustomerEnabled"
      | "supportEnabled"
      | "highPriorityEnabled"
      | "negativeSentimentEnabled"
      | "quietHoursEnabled"
      | "quietHoursStart"
      | "quietHoursEnd"
      | "timezone"
      | "allowUrgentDuringQuietHours"
    >
  > = {};

  if (input.inAppEnabled !== undefined) {
    data.inAppEnabled = input.inAppEnabled;
  }

  if (input.whatsappEnabled !== undefined) {
    data.whatsappEnabled = input.whatsappEnabled;
  }

  if (input.whatsappPhone !== undefined) {
    data.whatsappPhone =
      input.whatsappPhone === null || input.whatsappPhone.trim() === ""
        ? null
        : normalizeInternalWhatsappPhone(input.whatsappPhone);
  }

  if (input.minimumSeverity !== undefined) {
    data.minimumSeverity = input.minimumSeverity;
  }

  if (input.returningCustomerEnabled !== undefined) {
    data.returningCustomerEnabled = input.returningCustomerEnabled;
  }

  if (input.supportEnabled !== undefined) {
    data.supportEnabled = input.supportEnabled;
  }

  if (input.highPriorityEnabled !== undefined) {
    data.highPriorityEnabled = input.highPriorityEnabled;
  }

  if (input.negativeSentimentEnabled !== undefined) {
    data.negativeSentimentEnabled = input.negativeSentimentEnabled;
  }

  if (input.quietHoursEnabled !== undefined) {
    data.quietHoursEnabled = input.quietHoursEnabled;
  }

  if (input.quietHoursStart !== undefined) {
    if (input.quietHoursStart !== null && !isValidHHmm(input.quietHoursStart)) {
      throw new Error("quietHoursStart must use HH:mm format.");
    }

    data.quietHoursStart = input.quietHoursStart;
  }

  if (input.quietHoursEnd !== undefined) {
    if (input.quietHoursEnd !== null && !isValidHHmm(input.quietHoursEnd)) {
      throw new Error("quietHoursEnd must use HH:mm format.");
    }

    data.quietHoursEnd = input.quietHoursEnd;
  }

  if (input.timezone !== undefined) {
    if (!isValidTimezone(input.timezone)) {
      throw new Error("Invalid timezone.");
    }

    data.timezone = input.timezone;
  }

  if (input.allowUrgentDuringQuietHours !== undefined) {
    data.allowUrgentDuringQuietHours = input.allowUrgentDuringQuietHours;
  }

  return data;
}

export async function getNotificationPreference(input: {
  tenantId: string;
  userId: string;
}) {
  await validateNotificationPreferenceAccess(input);

  return prisma.notificationPreference.findUnique({
    where: {
      tenantId_userId: {
        tenantId: input.tenantId,
        userId: input.userId
      }
    }
  });
}

export async function upsertNotificationPreference(input: {
  tenantId: string;
  userId: string;
  preference: UpsertNotificationPreferenceInput;
}) {
  const membership = await validateNotificationPreferenceAccess(input);

  if (
    membership.role === MembershipRole.VIEWER &&
    input.preference.whatsappEnabled === true
  ) {
    throw new Error("VIEWER users cannot enable WhatsApp alert delivery.");
  }

  const data = buildPreferenceData(input.preference);

  if (
    data.quietHoursEnabled === true &&
    (!("quietHoursStart" in data) || !("quietHoursEnd" in data))
  ) {
    const existing = await prisma.notificationPreference.findUnique({
      where: {
        tenantId_userId: {
          tenantId: input.tenantId,
          userId: input.userId
        }
      },
      select: {
        quietHoursStart: true,
        quietHoursEnd: true
      }
    });

    if (!existing?.quietHoursStart || !existing?.quietHoursEnd) {
      throw new Error("Quiet hours require start and end times.");
    }
  }

  return prisma.notificationPreference.upsert({
    where: {
      tenantId_userId: {
        tenantId: input.tenantId,
        userId: input.userId
      }
    },
    create: {
      tenantId: input.tenantId,
      userId: input.userId,
      ...data
    },
    update: data
  });
}
