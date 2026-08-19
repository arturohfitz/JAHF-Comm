import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, WhatsAppProvider } from "@prisma/client";
import { config } from "dotenv";

config({ path: [".env.production", ".env", "../.env", "../../.env"] });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to check Evolution identities.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl })
});

type IdentityField = "instanceName" | "providerInstanceId" | "providerAccountId";

type AccountIdentity = {
  id: string;
  tenantId: string;
  provider: WhatsAppProvider;
  phoneNumber: string;
  normalizedPhoneNumber: string;
  instanceName: string | null;
  providerInstanceId: string | null;
  providerAccountId: string | null;
  tenant: {
    name: string;
    slug: string;
  };
};

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return "sin-telefono";
  }

  return `****${digits.slice(-4)}`;
}

function identityKey(account: AccountIdentity, field: IdentityField) {
  const value = account[field]?.trim();

  return value ? `${account.provider}:${value}` : null;
}

function findDuplicates(accounts: AccountIdentity[], field: IdentityField) {
  const groups = new Map<string, AccountIdentity[]>();

  for (const account of accounts) {
    const key = identityKey(account, field);

    if (!key) {
      continue;
    }

    groups.set(key, [...(groups.get(key) ?? []), account]);
  }

  return [...groups.entries()].filter(([, values]) => values.length > 1);
}

function printDuplicate(field: IdentityField, key: string, accounts: AccountIdentity[]) {
  console.error(`Duplicado ${field}: ${key}`);

  for (const account of accounts) {
    console.error(
      [
        `  tenant=${account.tenant.slug}`,
        `tenantName=${account.tenant.name}`,
        `accountId=${account.id}`,
        `phone=${maskPhone(account.phoneNumber || account.normalizedPhoneNumber)}`
      ].join(" ")
    );
  }
}

async function main() {
  const accounts = await prisma.whatsAppAccount.findMany({
    where: {
      provider: WhatsAppProvider.EVOLUTION
    },
    select: {
      id: true,
      tenantId: true,
      provider: true,
      phoneNumber: true,
      normalizedPhoneNumber: true,
      instanceName: true,
      providerInstanceId: true,
      providerAccountId: true,
      tenant: {
        select: {
          name: true,
          slug: true
        }
      }
    }
  });
  let duplicateCount = 0;

  for (const field of [
    "instanceName",
    "providerInstanceId",
    "providerAccountId"
  ] as const) {
    const duplicates = findDuplicates(accounts, field);

    duplicateCount += duplicates.length;

    for (const [key, values] of duplicates) {
      printDuplicate(field, key, values);
    }
  }

  if (duplicateCount > 0) {
    console.error(
      `Se encontraron ${duplicateCount} identidades Evolution duplicadas. Corrige antes de migrar.`
    );
    process.exitCode = 1;
    return;
  }

  console.log("No se encontraron identidades Evolution duplicadas.");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
