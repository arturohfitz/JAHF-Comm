import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "@jahf-comm/shared/passwords";
import { MembershipRole, PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: [".env.production", ".env", "../.env", "../../.env"] });

const databaseUrl = process.env.DATABASE_URL;
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD?.trim();
const tenantName = process.env.ADMIN_TENANT_NAME?.trim() || "JAHF Comm";
const tenantSlug = process.env.ADMIN_TENANT_SLUG?.trim() || "jahf-comm";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to create a production admin.");
}

if (!adminEmail) {
  throw new Error("ADMIN_EMAIL is required to create a production admin.");
}

if (!adminPassword || adminPassword.length < 12) {
  throw new Error(
    "ADMIN_PASSWORD is required and must have at least 12 characters."
  );
}

if (adminPassword === "change-this-password") {
  throw new Error("ADMIN_PASSWORD must not use the local demo password.");
}

const requiredDatabaseUrl = databaseUrl;
const requiredAdminEmail = adminEmail;
const requiredAdminPassword = adminPassword;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requiredDatabaseUrl })
});

async function main() {
  const passwordHash = await hashPassword(requiredAdminPassword);

  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    update: { name: tenantName },
    create: {
      name: tenantName,
      slug: tenantSlug
    },
    select: {
      id: true,
      name: true,
      slug: true
    }
  });

  const user = await prisma.user.upsert({
    where: { email: requiredAdminEmail },
    update: {
      name: "Owner",
      passwordHash,
      emailVerifiedAt: new Date()
    },
    create: {
      email: requiredAdminEmail,
      name: "Owner",
      passwordHash,
      emailVerifiedAt: new Date()
    },
    select: {
      id: true,
      email: true
    }
  });

  await prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id
      }
    },
    update: {
      role: MembershipRole.OWNER
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      role: MembershipRole.OWNER
    }
  });

  console.log(
    `Production owner is ready for tenant ${tenant.slug} with email ${user.email}.`
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
