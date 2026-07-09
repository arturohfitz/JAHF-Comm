import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "@jahf-comm/shared/passwords";
import {
  AIIntent,
  AuditAction,
  ContactStage,
  ConversationStage,
  CustomerEventType,
  MembershipRole,
  MessageDirection,
  MessageType,
  NotificationType,
  PaymentStatus,
  PrismaClient,
  SaleStatus,
  SupportStatus,
  Urgency,
  WhatsAppAccountStatus,
  WhatsAppProvider
} from "@prisma/client";
import { config } from "dotenv";

config({ path: [".env", "../.env", "../../.env", "../../../.env"] });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed demo data.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl })
});

const demoAdminEmail =
  process.env.DEMO_ADMIN_EMAIL?.trim() || "admin@jahfcomm.local";
const demoAdminPassword =
  process.env.DEMO_ADMIN_PASSWORD?.trim() || "change-this-password";

const demoContacts = [
  {
    name: "Ana Lopez",
    normalizedPhoneNumber: "+525512340001",
    phoneNumber: "55 1234 0001",
    email: "ana.demo@example.com",
    stage: ContactStage.SOLD
  },
  {
    name: "Bruno Martinez",
    normalizedPhoneNumber: "+525512340002",
    phoneNumber: "55 1234 0002",
    email: "bruno.demo@example.com",
    stage: ContactStage.PENDING_PAYMENT
  },
  {
    name: "Carla Torres",
    normalizedPhoneNumber: "+525512340003",
    phoneNumber: "55 1234 0003",
    email: "carla.demo@example.com",
    stage: ContactStage.SUPPORT_REQUESTED
  },
  {
    name: "Diego Ramirez",
    normalizedPhoneNumber: "+525512340004",
    phoneNumber: "55 1234 0004",
    email: "diego.demo@example.com",
    stage: ContactStage.QUOTED
  },
  {
    name: "Elena Garcia",
    normalizedPhoneNumber: "+525512340005",
    phoneNumber: "55 1234 0005",
    email: "elena.demo@example.com",
    stage: ContactStage.NEW
  }
] as const;

async function main() {
  await prisma.tenant.deleteMany({
    where: { slug: "jahf-demo" }
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: "JAHF Demo",
      slug: "jahf-demo"
    }
  });

  const adminPasswordHash = await hashPassword(demoAdminPassword);

  const adminUser = await prisma.user.upsert({
    where: { email: demoAdminEmail },
    update: {
      name: "Admin Demo",
      passwordHash: adminPasswordHash,
      emailVerifiedAt: new Date()
    },
    create: {
      email: demoAdminEmail,
      name: "Admin Demo",
      passwordHash: adminPasswordHash,
      emailVerifiedAt: new Date()
    }
  });

  await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      userId: adminUser.id,
      role: MembershipRole.OWNER
    }
  });

  const whatsappAccount = await prisma.whatsAppAccount.create({
    data: {
      tenantId: tenant.id,
      name: "WhatsApp Demo",
      displayName: "WhatsApp Demo",
      phoneNumber: "55 0000 0000",
      normalizedPhoneNumber: "+525500000000",
      provider: WhatsAppProvider.EVOLUTION,
      status: WhatsAppAccountStatus.CONNECTED,
      providerAccountId: "demo-evolution-instance",
      providerInstanceId: "demo-evolution-instance",
      instanceName: "demo-evolution-instance"
    }
  });

  const contacts = [];

  for (const contact of demoContacts) {
    contacts.push(
      await prisma.contact.create({
        data: {
          tenantId: tenant.id,
          ...contact
        }
      })
    );
  }

  const conversations = [];

  for (const [index, contact] of contacts.entries()) {
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        contactId: contact.id,
        whatsappAccountId: whatsappAccount.id,
        assignedUserId: adminUser.id,
        stage: index === 2 ? ConversationStage.ESCALATED : ConversationStage.OPEN,
        subject: `Conversacion demo ${index + 1}`,
        lastMessageAt: new Date()
      }
    });

    conversations.push(conversation);

    await prisma.message.createMany({
      data: [
        {
          tenantId: tenant.id,
          conversationId: conversation.id,
          contactId: contact.id,
          whatsappAccountId: whatsappAccount.id,
          direction: MessageDirection.INBOUND,
          type: MessageType.TEXT,
          text: `Hola, soy ${contact.name}. Me interesa recibir informacion.`,
          providerMessageId: `demo-in-${index + 1}`,
          rawPayload: { demo: true, direction: "inbound" },
          sentAt: new Date()
        },
        {
          tenantId: tenant.id,
          conversationId: conversation.id,
          contactId: contact.id,
          whatsappAccountId: whatsappAccount.id,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEXT,
          text: "Gracias por escribirnos. Ya estamos revisando tu caso.",
          providerMessageId: `demo-out-${index + 1}`,
          rawPayload: { demo: true, direction: "outbound" },
          sentAt: new Date()
        }
      ],
      skipDuplicates: true
    });
  }

  const paidSale = await prisma.sale.create({
    data: {
      tenantId: tenant.id,
      contactId: contacts[0].id,
      conversationId: conversations[0].id,
      product: "Plan anual demo",
      amountCents: 120000,
      currency: "MXN",
      soldAt: new Date(),
      status: SaleStatus.PAID
    }
  });

  await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      contactId: contacts[0].id,
      saleId: paidSale.id,
      amountDueCents: 120000,
      amountPaidCents: 120000,
      currency: "MXN",
      paidAt: new Date(),
      status: PaymentStatus.PAID,
      reference: "DEMO-PAID-001"
    }
  });

  const pendingSale = await prisma.sale.create({
    data: {
      tenantId: tenant.id,
      contactId: contacts[1].id,
      conversationId: conversations[1].id,
      product: "Configuracion inicial demo",
      amountCents: 45000,
      currency: "MXN",
      soldAt: new Date(),
      status: SaleStatus.PENDING
    }
  });

  await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      contactId: contacts[1].id,
      saleId: pendingSale.id,
      amountDueCents: 45000,
      amountPaidCents: 0,
      currency: "MXN",
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: PaymentStatus.PENDING,
      reference: "DEMO-PENDING-001"
    }
  });

  await prisma.supportTicket.create({
    data: {
      tenantId: tenant.id,
      contactId: contacts[2].id,
      conversationId: conversations[2].id,
      assignedUserId: adminUser.id,
      title: "Soporte demo abierto",
      description: "El cliente solicita ayuda con configuracion.",
      status: SupportStatus.OPEN,
      priority: Urgency.HIGH
    }
  });

  const firstMessage = await prisma.message.findFirstOrThrow({
    where: {
      tenantId: tenant.id,
      conversationId: conversations[0].id,
      direction: MessageDirection.INBOUND
    }
  });

  await prisma.aIClassification.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversations[0].id,
      contactId: contacts[0].id,
      messageId: firstMessage.id,
      detectedIntent: AIIntent.SALES,
      urgency: Urgency.MEDIUM,
      confidence: 0.87,
      summary: "Cliente interesado en informacion comercial.",
      recommendedAction: "Asignar seguimiento de ventas.",
      rawResult: {
        demo: true,
        labels: ["sales", "follow_up"]
      }
    }
  });

  await prisma.notification.create({
    data: {
      tenantId: tenant.id,
      userId: adminUser.id,
      type: NotificationType.ACTION_REQUIRED,
      title: "Seguimiento demo pendiente",
      description: "Revisar la conversacion de Ana Lopez.",
      isRead: false
    }
  });

  await prisma.customerEvent.createMany({
    data: [
      {
        tenantId: tenant.id,
        contactId: contacts[0].id,
        conversationId: conversations[0].id,
        actorUserId: adminUser.id,
        type: CustomerEventType.SALE_RECORDED,
        title: "Venta demo pagada",
        description: "Se registro una venta pagada para el cliente demo.",
        metadata: { saleId: paidSale.id }
      },
      {
        tenantId: tenant.id,
        contactId: contacts[1].id,
        conversationId: conversations[1].id,
        actorUserId: adminUser.id,
        type: CustomerEventType.PAYMENT_UPDATED,
        title: "Pago demo pendiente",
        description: "Se registro una venta pendiente de pago.",
        metadata: { saleId: pendingSale.id }
      }
    ]
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorUserId: adminUser.id,
      action: AuditAction.CREATE,
      entityType: "Tenant",
      entityId: tenant.id,
      after: {
        name: tenant.name,
        slug: tenant.slug
      }
    }
  });
}

await main();
await prisma.$disconnect();
