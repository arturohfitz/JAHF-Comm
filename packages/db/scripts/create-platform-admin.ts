import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "@jahf-comm/shared/passwords";
import { PlatformRole, PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: [".env.production", ".env", "../.env", "../../.env"] });

const databaseUrl = process.env.DATABASE_URL;
const adminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD?.trim();
const adminName = process.env.PLATFORM_ADMIN_NAME?.trim() || "Administrador Maestro";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to create a platform admin.");
}

if (!adminEmail) {
  throw new Error("PLATFORM_ADMIN_EMAIL is required.");
}

if (!adminPassword || adminPassword.length < 16) {
  throw new Error(
    "PLATFORM_ADMIN_PASSWORD is required and must have at least 16 characters."
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl })
});

async function main() {
  const passwordHash = await hashPassword(adminPassword as string);
  const user = await prisma.user.upsert({
    where: { email: adminEmail as string },
    update: {
      name: adminName,
      passwordHash,
      platformRole: PlatformRole.SUPER_ADMIN,
      mustChangePassword: true,
      emailVerifiedAt: new Date()
    },
    create: {
      email: adminEmail as string,
      name: adminName,
      passwordHash,
      platformRole: PlatformRole.SUPER_ADMIN,
      mustChangePassword: true,
      emailVerifiedAt: new Date()
    },
    select: {
      id: true,
      email: true
    }
  });

  console.log(`Platform admin ready: ${user.email} (${user.id}).`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
