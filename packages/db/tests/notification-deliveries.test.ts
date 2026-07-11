import assert from "node:assert/strict";
import test, { after } from "node:test";

import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });

const databaseUrl = process.env.DATABASE_URL_TEST;
const developmentDatabaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required for NotificationDelivery tests.");
}

const testDatabase = new URL(databaseUrl);
const databaseName = testDatabase.pathname.replace("/", "");

if (!["test", "testing"].some((marker) => databaseName.includes(marker))) {
  throw new Error("DATABASE_URL_TEST must point to a database marked as test.");
}

if (developmentDatabaseUrl) {
  const developmentDatabase = new URL(developmentDatabaseUrl);

  if (
    developmentDatabase.host === testDatabase.host &&
    developmentDatabase.pathname === testDatabase.pathname
  ) {
    throw new Error("DATABASE_URL_TEST must not point to DATABASE_URL.");
  }
}

process.env.DATABASE_URL = databaseUrl;

const {
  ContactStage,
  ConversationStage,
  MembershipRole,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationSeverity,
  NotificationType,
  WhatsAppAccountStatus,
  WhatsAppProvider,
  prisma
} = await import("../src/index.js");
const {
  buildWhatsAppNotificationText,
  calculateQuietHoursEnd,
  isWithinQuietHours,
  meetsMinimumSeverity,
  prepareWhatsappNotificationDelivery
} = await import("../src/notification-deliveries.js");
const {
  normalizeInternalWhatsappPhone,
  upsertNotificationPreference
} = await import("../src/notification-preferences.js");
const { setTenantWhatsappAlertsAccount } = await import(
  "../src/tenant-notification-settings.js"
);
const { customerAlertSource } = await import("../src/customer-alerts.js");
const { createNotificationDeliveryJobId } = await import("@jahf-comm/shared");

const runId = `nd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sequence = 0;

after(async () => {
  await prisma.tenant.deleteMany({
    where: {
      slug: {
        startsWith: runId
      }
    }
  });
  await prisma.$disconnect();
});

function nextId(label: string) {
  sequence += 1;
  return `${runId}-${label}-${sequence}`;
}

async function createBase(label: string) {
  const suffix = nextId(label);
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${suffix}`,
      slug: `${runId}-${suffix}`
    }
  });
  const otherTenant = await prisma.tenant.create({
    data: {
      name: `Other ${suffix}`,
      slug: `${runId}-${suffix}-other`
    }
  });
  const owner = await prisma.user.create({
    data: { email: `${suffix}-owner@example.com`, name: "Owner" }
  });
  const admin = await prisma.user.create({
    data: { email: `${suffix}-admin@example.com`, name: "Admin" }
  });
  const agent = await prisma.user.create({
    data: { email: `${suffix}-agent@example.com`, name: "Agent" }
  });
  const viewer = await prisma.user.create({
    data: { email: `${suffix}-viewer@example.com`, name: "Viewer" }
  });
  const outsider = await prisma.user.create({
    data: { email: `${suffix}-outsider@example.com`, name: "Outsider" }
  });

  await prisma.membership.createMany({
    data: [
      { tenantId: tenant.id, userId: owner.id, role: MembershipRole.OWNER },
      { tenantId: tenant.id, userId: admin.id, role: MembershipRole.ADMIN },
      { tenantId: tenant.id, userId: agent.id, role: MembershipRole.AGENT },
      { tenantId: tenant.id, userId: viewer.id, role: MembershipRole.VIEWER },
      { tenantId: otherTenant.id, userId: outsider.id, role: MembershipRole.OWNER }
    ]
  });

  const contact = await prisma.contact.create({
    data: {
      tenantId: tenant.id,
      name: `Cliente ${suffix}`,
      normalizedPhoneNumber: `+52155${sequence.toString().padStart(8, "0")}`,
      phoneNumber: `+52155${sequence.toString().padStart(8, "0")}`,
      stage: ContactStage.PROSPECT
    }
  });
  const account = await prisma.whatsAppAccount.create({
    data: {
      tenantId: tenant.id,
      name: `WhatsApp ${suffix}`,
      phoneNumber: `+52156${sequence.toString().padStart(8, "0")}`,
      normalizedPhoneNumber: `+52156${sequence.toString().padStart(8, "0")}`,
      provider: WhatsAppProvider.EVOLUTION,
      status: WhatsAppAccountStatus.CONNECTED,
      providerInstanceId: `instance-${suffix}`,
      instanceName: `instance-${suffix}`
    }
  });
  const otherAccount = await prisma.whatsAppAccount.create({
    data: {
      tenantId: otherTenant.id,
      name: `Other WhatsApp ${suffix}`,
      phoneNumber: `+52157${sequence.toString().padStart(8, "0")}`,
      normalizedPhoneNumber: `+52157${sequence.toString().padStart(8, "0")}`,
      provider: WhatsAppProvider.EVOLUTION,
      status: WhatsAppAccountStatus.CONNECTED,
      providerInstanceId: `other-instance-${suffix}`,
      instanceName: `other-instance-${suffix}`
    }
  });
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      whatsappAccountId: account.id,
      assignedUserId: agent.id,
      stage: ConversationStage.OPEN
    }
  });

  await prisma.customerMemory.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      commercialSummary: "Cliente regreso despues de varios dias.",
      recommendedNextAction: "Responder con seguimiento comercial factual."
    }
  });

  return {
    tenant,
    otherTenant,
    owner,
    admin,
    agent,
    viewer,
    outsider,
    contact,
    account,
    otherAccount,
    conversation
  };
}

async function createCustomerAlertNotification(
  base: Awaited<ReturnType<typeof createBase>>,
  input: {
    userId?: string;
    severity?: typeof NotificationSeverity[keyof typeof NotificationSeverity];
    rules?: string[];
  } = {}
) {
  return prisma.notification.create({
    data: {
      tenantId: base.tenant.id,
      userId: input.userId ?? base.agent.id,
      type: NotificationType.ACTION_REQUIRED,
      severity: input.severity ?? NotificationSeverity.HIGH,
      title: "Cliente reactivado",
      description: "El cliente volvio y requiere seguimiento.",
      metadata: {
        source: customerAlertSource,
        rules: input.rules ?? ["CUSTOMER_COMMERCIAL_REACTIVATION"],
        contactId: base.contact.id,
        conversationId: base.conversation.id,
        triggerMessageId: nextId("message"),
        returnType: "COMMERCIAL_REACTIVATION",
        inactivityMinutes: 11000,
        hasRegisteredSale: false,
        salesCount: 0,
        openSupportTicketsCount: 0,
        intent: "FOLLOW_UP",
        priority: "HIGH",
        sentiment: "NEUTRAL",
        href: `/inbox?conversationId=${base.conversation.id}`,
        rawCustomerMessage: "este texto no debe copiarse al delivery"
      }
    }
  });
}

async function configureReadyDelivery(
  base: Awaited<ReturnType<typeof createBase>>,
  input: {
    whatsappEnabled?: boolean;
    whatsappPhone?: string | null;
    minimumSeverity?: typeof NotificationSeverity[keyof typeof NotificationSeverity];
    quietHoursEnabled?: boolean;
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
    allowUrgentDuringQuietHours?: boolean;
    rules?: string[];
  } = {}
) {
  await prisma.tenantNotificationSettings.upsert({
    where: { tenantId: base.tenant.id },
    create: {
      tenantId: base.tenant.id,
      whatsappAlertsAccountId: base.account.id,
      whatsappAlertsEnabled: true
    },
    update: {
      whatsappAlertsAccountId: base.account.id,
      whatsappAlertsEnabled: true
    }
  });
  await upsertNotificationPreference({
    tenantId: base.tenant.id,
    userId: base.agent.id,
    preference: {
      whatsappEnabled: input.whatsappEnabled ?? true,
      whatsappPhone: input.whatsappPhone ?? "+5215512345678",
      minimumSeverity: input.minimumSeverity ?? NotificationSeverity.HIGH,
      quietHoursEnabled: input.quietHoursEnabled,
      quietHoursStart: input.quietHoursStart,
      quietHoursEnd: input.quietHoursEnd,
      allowUrgentDuringQuietHours: input.allowUrgentDuringQuietHours
    }
  });

  return createCustomerAlertNotification(base, { rules: input.rules });
}

test("Notification.severity usa default MEDIUM para datos existentes y nuevos", async () => {
  const base = await createBase("default-severity");
  const notification = await prisma.notification.create({
    data: {
      tenantId: base.tenant.id,
      userId: base.owner.id,
      type: NotificationType.INFO,
      title: "Sin severidad explicita"
    }
  });

  assert.equal(notification.severity, NotificationSeverity.MEDIUM);
});

test("normaliza telefono interno y rechaza valores invalidos", () => {
  assert.equal(normalizeInternalWhatsappPhone("52 1 55 1234 5678"), "+5215512345678");
  assert.throws(() => normalizeInternalWhatsappPhone("abc"));
});

test("preferencias validan membresia, rol viewer, timezone y horas silenciosas", async () => {
  const base = await createBase("preferences");

  await assert.rejects(() =>
    upsertNotificationPreference({
      tenantId: base.tenant.id,
      userId: base.outsider.id,
      preference: { whatsappEnabled: true, whatsappPhone: "+5215511111111" }
    })
  );
  await assert.rejects(() =>
    upsertNotificationPreference({
      tenantId: base.tenant.id,
      userId: base.viewer.id,
      preference: { whatsappEnabled: true, whatsappPhone: "+5215511111111" }
    })
  );
  await assert.rejects(() =>
    upsertNotificationPreference({
      tenantId: base.tenant.id,
      userId: base.agent.id,
      preference: { timezone: "Mars/Base" }
    })
  );
  await assert.rejects(() =>
    upsertNotificationPreference({
      tenantId: base.tenant.id,
      userId: base.agent.id,
      preference: { quietHoursStart: "25:00" }
    })
  );

  const preference = await upsertNotificationPreference({
    tenantId: base.tenant.id,
    userId: base.agent.id,
    preference: { whatsappPhone: "+5215511111111" }
  });

  assert.equal(preference.whatsappEnabled, false);
  assert.equal(preference.whatsappPhone, "+5215511111111");
});

test("settings de tenant requieren OWNER/ADMIN, validan cuenta por tenant y no activan alertas solos", async () => {
  const base = await createBase("settings");

  await assert.rejects(() =>
    setTenantWhatsappAlertsAccount({
      tenantId: base.tenant.id,
      actorUserId: base.agent.id,
      whatsappAccountId: base.account.id
    })
  );
  await assert.rejects(() =>
    setTenantWhatsappAlertsAccount({
      tenantId: base.tenant.id,
      actorUserId: base.owner.id,
      whatsappAccountId: base.otherAccount.id
    })
  );

  const settings = await setTenantWhatsappAlertsAccount({
    tenantId: base.tenant.id,
    actorUserId: base.owner.id,
    whatsappAccountId: base.account.id
  });

  assert.equal(settings.whatsappAlertsAccountId, base.account.id);
  assert.equal(settings.whatsappAlertsEnabled, false);
});

test("job id de notification-delivery es deterministico y seguro para BullMQ", () => {
  const payload = {
    tenantId: "tenant-a",
    notificationId: "notification-a",
    channel: "WHATSAPP" as const
  };
  const first = createNotificationDeliveryJobId(payload);
  const second = createNotificationDeliveryJobId(payload);

  assert.equal(first, second);
  assert.equal(first.includes(":"), false);
});

test("severidad respeta minimo configurado", () => {
  assert.equal(
    meetsMinimumSeverity({
      notificationSeverity: NotificationSeverity.HIGH,
      minimumSeverity: NotificationSeverity.MEDIUM
    }),
    true
  );
  assert.equal(
    meetsMinimumSeverity({
      notificationSeverity: NotificationSeverity.MEDIUM,
      minimumSeverity: NotificationSeverity.HIGH
    }),
    false
  );
});

test("horarios silenciosos detectan rangos normales y cruzando medianoche", () => {
  assert.equal(
    isWithinQuietHours({
      now: new Date("2026-01-01T03:30:00.000Z"),
      timezone: "UTC",
      start: "02:00",
      end: "04:00"
    }),
    true
  );
  assert.equal(
    isWithinQuietHours({
      now: new Date("2026-01-01T23:30:00.000Z"),
      timezone: "UTC",
      start: "22:00",
      end: "06:00"
    }),
    true
  );
  assert.equal(
    calculateQuietHoursEnd({
      now: new Date("2026-01-01T23:30:00.000Z"),
      timezone: "UTC",
      start: "22:00",
      end: "06:00"
    }).toISOString(),
    "2026-01-02T06:00:00.000Z"
  );
});

test("message builder enmascara telefono, limita longitud y no expone texto raw", () => {
  const text = buildWhatsAppNotificationText({
    title: "Cliente reactivado",
    description: "Resumen factual ".repeat(80),
    contactName: "Cliente Demo",
    contactPhone: "+5215512345678",
    rules: ["CUSTOMER_COMMERCIAL_REACTIVATION"],
    summary: "Memoria factual",
    recommendedAction: "Dar seguimiento",
    url: "http://localhost:3000/inbox?conversationId=abc"
  });

  assert.equal(text.includes("+5215512345678"), false);
  assert.equal(text.includes("****5678"), true);
  assert.equal(text.length <= 1800, true);
});

test("delivery se marca SKIPPED cuando tenant, usuario o preferencia no permiten WhatsApp", async () => {
  const disabledTenant = await createBase("skip-tenant");
  await upsertNotificationPreference({
    tenantId: disabledTenant.tenant.id,
    userId: disabledTenant.agent.id,
    preference: {
      whatsappEnabled: true,
      whatsappPhone: "+5215512345678"
    }
  });
  const disabledTenantNotification =
    await createCustomerAlertNotification(disabledTenant);
  const disabledTenantResult = await prepareWhatsappNotificationDelivery({
    tenantId: disabledTenant.tenant.id,
    notificationId: disabledTenantNotification.id
  });

  assert.equal(disabledTenantResult.delivery?.status, NotificationDeliveryStatus.SKIPPED);
  assert.equal(disabledTenantResult.delivery?.errorCode, "TENANT_WHATSAPP_ALERTS_DISABLED");

  const disabledUser = await createBase("skip-user");
  const disabledUserNotification = await configureReadyDelivery(disabledUser, {
    whatsappEnabled: false
  });
  const disabledUserResult = await prepareWhatsappNotificationDelivery({
    tenantId: disabledUser.tenant.id,
    notificationId: disabledUserNotification.id
  });

  assert.equal(disabledUserResult.delivery?.status, NotificationDeliveryStatus.SKIPPED);
  assert.equal(disabledUserResult.delivery?.errorCode, "USER_WHATSAPP_DISABLED");

  const belowSeverity = await createBase("skip-severity");
  const belowSeverityNotification = await configureReadyDelivery(belowSeverity, {
    minimumSeverity: NotificationSeverity.URGENT
  });
  const belowSeverityResult = await prepareWhatsappNotificationDelivery({
    tenantId: belowSeverity.tenant.id,
    notificationId: belowSeverityNotification.id
  });

  assert.equal(belowSeverityResult.delivery?.status, NotificationDeliveryStatus.SKIPPED);
  assert.equal(belowSeverityResult.delivery?.errorCode, "BELOW_MINIMUM_SEVERITY");
});

test("delivery respeta preferencias por tipo de alerta", async () => {
  const returning = await createBase("skip-returning");
  const returningNotification = await configureReadyDelivery(returning);
  await prisma.notificationPreference.update({
    where: {
      tenantId_userId: {
        tenantId: returning.tenant.id,
        userId: returning.agent.id
      }
    },
    data: { returningCustomerEnabled: false }
  });
  const returningResult = await prepareWhatsappNotificationDelivery({
    tenantId: returning.tenant.id,
    notificationId: returningNotification.id
  });

  assert.equal(returningResult.delivery?.errorCode, "RETURNING_CUSTOMER_ALERTS_DISABLED");

  const support = await createBase("skip-support");
  const supportNotification = await configureReadyDelivery(support, {
    rules: ["PREVIOUS_CUSTOMER_REQUESTS_SUPPORT"]
  });
  await prisma.notificationPreference.update({
    where: {
      tenantId_userId: {
        tenantId: support.tenant.id,
        userId: support.agent.id
      }
    },
    data: { supportEnabled: false }
  });
  const supportResult = await prepareWhatsappNotificationDelivery({
    tenantId: support.tenant.id,
    notificationId: supportNotification.id
  });

  assert.equal(supportResult.delivery?.errorCode, "SUPPORT_ALERTS_DISABLED");

  const negative = await createBase("skip-negative");
  const negativeNotification = await configureReadyDelivery(negative, {
    rules: ["NEGATIVE_CUSTOMER_SENTIMENT"]
  });
  const negativeResult = await prepareWhatsappNotificationDelivery({
    tenantId: negative.tenant.id,
    notificationId: negativeNotification.id
  });

  assert.equal(negativeResult.delivery?.errorCode, "NEGATIVE_SENTIMENT_ALERTS_DISABLED");
});

test("quiet hours dejan delivery en PENDING y URGENT puede pasar si esta permitido", async () => {
  const pending = await createBase("pending-quiet");
  const pendingNotification = await configureReadyDelivery(pending, {
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "06:00"
  });
  const pendingResult = await prepareWhatsappNotificationDelivery({
    tenantId: pending.tenant.id,
    notificationId: pendingNotification.id,
    now: new Date("2026-01-01T23:30:00.000Z")
  });

  assert.equal(pendingResult.delivery?.status, NotificationDeliveryStatus.PENDING);
  assert.equal(pendingResult.delivery?.errorCode, "QUIET_HOURS");
  assert.equal(pendingResult.delivery?.nextAttemptAt?.toISOString(), "2026-01-02T06:00:00.000Z");

  const urgent = await createBase("urgent-quiet");
  await configureReadyDelivery(urgent, {
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "06:00",
    allowUrgentDuringQuietHours: true
  });
  const urgentNotification = await createCustomerAlertNotification(urgent, {
    severity: NotificationSeverity.URGENT,
    rules: ["URGENT_CUSTOMER_MESSAGE"]
  });
  const urgentResult = await prepareWhatsappNotificationDelivery({
    tenantId: urgent.tenant.id,
    notificationId: urgentNotification.id,
    now: new Date("2026-01-01T23:30:00.000Z")
  });

  assert.equal(urgentResult.delivery?.status, NotificationDeliveryStatus.DRY_RUN);
});

test("dry-run crea delivery idempotente sin crear mensajes, contactos ni conversaciones", async () => {
  const base = await createBase("dry-run");
  const notification = await configureReadyDelivery(base);
  const before = await Promise.all([
    prisma.contact.count({ where: { tenantId: base.tenant.id } }),
    prisma.conversation.count({ where: { tenantId: base.tenant.id } }),
    prisma.message.count({ where: { tenantId: base.tenant.id } })
  ]);
  const first = await prepareWhatsappNotificationDelivery({
    tenantId: base.tenant.id,
    notificationId: notification.id,
    publicUrl: "http://localhost:3000"
  });
  const second = await prepareWhatsappNotificationDelivery({
    tenantId: base.tenant.id,
    notificationId: notification.id,
    publicUrl: "http://localhost:3000"
  });
  const afterCounts = await Promise.all([
    prisma.contact.count({ where: { tenantId: base.tenant.id } }),
    prisma.conversation.count({ where: { tenantId: base.tenant.id } }),
    prisma.message.count({ where: { tenantId: base.tenant.id } })
  ]);
  const deliveries = await prisma.notificationDelivery.findMany({
    where: {
      tenantId: base.tenant.id,
      notificationId: notification.id,
      channel: NotificationChannel.WHATSAPP
    }
  });
  const metadata = deliveries[0]?.metadata as Record<string, unknown> | undefined;

  assert.equal(first.delivery?.status, NotificationDeliveryStatus.DRY_RUN);
  assert.equal(second.delivery?.id, first.delivery?.id);
  assert.equal(deliveries.length, 1);
  assert.deepEqual(afterCounts, before);
  assert.equal(typeof metadata?.messageHash, "string");
  assert.equal((metadata?.messageHash as string).length, 64);
  assert.equal(metadata?.destinationMasked, "**********5678");
  assert.equal(JSON.stringify(metadata).includes("este texto no debe copiarse"), false);
});

test("notificacion sin usuario no crea delivery y notificacion inexistente queda skipped", async () => {
  const base = await createBase("missing");
  const noUser = await prisma.notification.create({
    data: {
      tenantId: base.tenant.id,
      type: NotificationType.INFO,
      title: "Sin usuario"
    }
  });

  assert.equal(
    (
      await prepareWhatsappNotificationDelivery({
        tenantId: base.tenant.id,
        notificationId: noUser.id
      })
    ).status,
    "skipped_missing_user"
  );
  assert.equal(
    (
      await prepareWhatsappNotificationDelivery({
        tenantId: base.tenant.id,
        notificationId: "missing-notification"
      })
    ).status,
    "skipped_missing_notification"
  );
});
