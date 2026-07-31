import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";

import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });

const databaseUrl = process.env.DATABASE_URL_TEST;
const developmentDatabaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required for PlatformSecurity tests.");
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
  PlatformRole,
  PaymentStatus,
  SaleStatus,
  SupportStatus,
  Urgency,
  WhatsAppAccountStatus,
  WhatsAppProvider,
  prisma
} = await import("../src/index.js");

const execFileAsync = promisify(execFile);
const runId = `platform-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const testDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(testDir, "..");
let sequence = 0;

after(async () => {
  await prisma.tenant.deleteMany({
    where: { slug: { startsWith: runId } }
  });
  await prisma.user.deleteMany({
    where: { email: { contains: `${runId}@` } }
  });
  await prisma.$disconnect();
});

function nextId(label: string) {
  sequence += 1;
  return `${runId}-${label}-${sequence}`;
}

async function createTenantGraph(label: string) {
  const suffix = nextId(label);
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${suffix}`,
      slug: `${runId}-${suffix}`,
      onboardingCompletedAt: new Date()
    }
  });
  const user = await prisma.user.create({
    data: {
      email: `${suffix}-${runId}@example.com`,
      name: `User ${suffix}`
    }
  });

  await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      role: MembershipRole.OWNER
    }
  });

  const account = await prisma.whatsAppAccount.create({
    data: {
      tenantId: tenant.id,
      name: `Account ${suffix}`,
      phoneNumber: `+52155${sequence.toString().padStart(8, "0")}`,
      normalizedPhoneNumber: `+52155${sequence.toString().padStart(8, "0")}`,
      provider: WhatsAppProvider.EVOLUTION,
      status: WhatsAppAccountStatus.CONNECTED,
      instanceName: `instance-${suffix}`,
      providerInstanceId: `provider-instance-${suffix}`,
      providerAccountId: `provider-account-${suffix}`
    }
  });
  const contact = await prisma.contact.create({
    data: {
      tenantId: tenant.id,
      name: `Contact ${suffix}`,
      normalizedPhoneNumber: `+52156${sequence.toString().padStart(8, "0")}`,
      phoneNumber: `+52156${sequence.toString().padStart(8, "0")}`,
      stage: ContactStage.PROSPECT
    }
  });
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      whatsappAccountId: account.id,
      stage: ConversationStage.OPEN
    }
  });
  const sale = await prisma.sale.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      conversationId: conversation.id,
      product: "Venta test",
      amountCents: 10000,
      status: SaleStatus.PENDING,
      soldAt: new Date()
    }
  });
  const payment = await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      saleId: sale.id,
      amountDueCents: 10000,
      status: PaymentStatus.PENDING
    }
  });
  const ticket = await prisma.supportTicket.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      conversationId: conversation.id,
      title: "Ticket test",
      status: SupportStatus.OPEN,
      priority: Urgency.HIGH
    }
  });

  return { tenant, user, account, contact, conversation, sale, payment, ticket };
}

test("tenant A no puede consultar ni modificar registros de tenant B con IDs manuales", async () => {
  const tenantA = await createTenantGraph("tenant-a");
  const tenantB = await createTenantGraph("tenant-b");
  const leakedConversation = await prisma.conversation.findFirst({
    where: {
      tenantId: tenantA.tenant.id,
      id: tenantB.conversation.id
    }
  });
  const contactUpdate = await prisma.contact.updateMany({
    where: {
      tenantId: tenantA.tenant.id,
      id: tenantB.contact.id
    },
    data: { stage: ContactStage.SOLD }
  });
  const conversationUpdate = await prisma.conversation.updateMany({
    where: {
      tenantId: tenantA.tenant.id,
      id: tenantB.conversation.id
    },
    data: { stage: ConversationStage.CLOSED }
  });
  const [sales, payments, tickets] = await Promise.all([
    prisma.sale.count({
      where: { tenantId: tenantA.tenant.id, id: tenantB.sale.id }
    }),
    prisma.payment.count({
      where: { tenantId: tenantA.tenant.id, id: tenantB.payment.id }
    }),
    prisma.supportTicket.count({
      where: { tenantId: tenantA.tenant.id, id: tenantB.ticket.id }
    })
  ]);

  assert.equal(leakedConversation, null);
  assert.equal(contactUpdate.count, 0);
  assert.equal(conversationUpdate.count, 0);
  assert.equal(sales, 0);
  assert.equal(payments, 0);
  assert.equal(tickets, 0);
});

test("identidades Evolution son globalmente unicas por provider", async () => {
  const tenantA = await createTenantGraph("evolution-a");
  const tenantB = await createTenantGraph("evolution-b");
  const baseData = {
    tenantId: tenantB.tenant.id,
    name: "Duplicada",
    phoneNumber: "+5215599999999",
    normalizedPhoneNumber: "+5215599999999",
    provider: WhatsAppProvider.EVOLUTION,
    status: WhatsAppAccountStatus.PENDING
  };

  await assert.rejects(
    prisma.whatsAppAccount.create({
      data: {
        ...baseData,
        normalizedPhoneNumber: "+5215599999901",
        instanceName: tenantA.account.instanceName,
        providerInstanceId: `unique-provider-${nextId("dup")}`,
        providerAccountId: `unique-account-${nextId("dup")}`
      }
    })
  );
  await assert.rejects(
    prisma.whatsAppAccount.create({
      data: {
        ...baseData,
        normalizedPhoneNumber: "+5215599999902",
        instanceName: `unique-instance-${nextId("dup")}`,
        providerInstanceId: tenantA.account.providerInstanceId,
        providerAccountId: `unique-account-${nextId("dup")}`
      }
    })
  );
  await assert.rejects(
    prisma.whatsAppAccount.create({
      data: {
        ...baseData,
        normalizedPhoneNumber: "+5215599999903",
        instanceName: `unique-instance-${nextId("dup")}`,
        providerInstanceId: `unique-provider-${nextId("dup")}`,
        providerAccountId: tenantA.account.providerAccountId
      }
    })
  );
});

test("script de administrador maestro no crea Membership ni imprime contraseña", async () => {
  const email = `${nextId("platform-admin")}-${runId}@example.com`;
  const password = "temporary-platform-secret-123";
  const { stdout, stderr } = await execFileAsync(
    "tsx",
    ["scripts/create-platform-admin.ts"],
    {
      cwd: packageDir,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PLATFORM_ADMIN_EMAIL: email,
        PLATFORM_ADMIN_PASSWORD: password,
        PLATFORM_ADMIN_NAME: "Admin Maestro Test"
      }
    }
  );
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: {
      id: true,
      platformRole: true,
      mustChangePassword: true,
      memberships: { select: { id: true } }
    }
  });
  const output = `${stdout}\n${stderr}`;

  assert.equal(user.platformRole, PlatformRole.SUPER_ADMIN);
  assert.equal(user.mustChangePassword, true);
  assert.equal(user.memberships.length, 0);
  assert.equal(output.includes(password), false);
  assert.match(output, new RegExp(email));
});
