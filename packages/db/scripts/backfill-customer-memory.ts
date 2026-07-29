import { pathToFileURL } from "node:url";

import { refreshCustomerMemory } from "../src/customer-memory.js";
import { prisma } from "../src/index.js";

type BackfillOptions = {
  tenantId?: string;
  batchSize: number;
};

function readArgValue(args: string[], key: string) {
  const index = args.indexOf(key);

  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions(): BackfillOptions {
  const args = process.argv.slice(2);
  const rawBatchSize = readArgValue(args, "--batchSize");
  const batchSize = rawBatchSize ? Number(rawBatchSize) : 100;

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error("--batchSize debe ser un entero entre 1 y 1000.");
  }

  return {
    tenantId: readArgValue(args, "--tenantId"),
    batchSize
  };
}

export async function runCustomerMemoryBackfill(
  options: BackfillOptions = parseOptions()
) {
  let lastId: string | null = null;
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  console.log("Iniciando backfill de CustomerMemory.", {
    tenantId: options.tenantId ?? "all",
    batchSize: options.batchSize
  });

  for (;;) {
    const contacts: Array<{ id: string; tenantId: string }> =
      await prisma.contact.findMany({
      where: {
        tenantId: options.tenantId,
        id: lastId ? { gt: lastId } : undefined
      },
      orderBy: { id: "asc" },
      take: options.batchSize,
      select: {
        id: true,
        tenantId: true
      }
    });

    if (contacts.length === 0) {
      break;
    }

    for (const contact of contacts) {
      try {
        await refreshCustomerMemory({
          tenantId: contact.tenantId,
          contactId: contact.id
        });
        processed += 1;
      } catch (error) {
        errors += 1;
        console.error("No se pudo refrescar CustomerMemory.", {
          tenantId: contact.tenantId,
          contactId: contact.id,
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }

    lastId = contacts[contacts.length - 1]?.id ?? lastId;
    console.log("Avance de backfill CustomerMemory.", {
      processed,
      skipped,
      errors,
      lastId
    });
  }

  console.log("Backfill de CustomerMemory terminado.", {
    processed,
    skipped,
    errors
  });

  if (errors > 0) {
    process.exitCode = 1;
  }

  return {
    processed,
    skipped,
    errors
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runCustomerMemoryBackfill();
  await prisma.$disconnect();
}
