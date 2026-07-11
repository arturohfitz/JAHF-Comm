import { config } from "dotenv";

import {
  getWhatsappAlertRuntimeConfig,
  markStaleWhatsappDeliveriesUnknown
} from "../src/notification-deliveries.js";
import { prisma } from "../src/index.js";

config({ path: [".env", "../../.env"] });

function readArg(name: string) {
  const prefix = `--${name}=`;

  return process.argv
    .slice(2)
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
}

async function main() {
  const runtime = getWhatsappAlertRuntimeConfig();
  const result = await markStaleWhatsappDeliveriesUnknown({
    tenantId: readArg("tenantId"),
    staleMinutes: runtime.processingStaleMinutes
  });

  console.log("Stale WhatsApp deliveries marked UNKNOWN.", result);
  await prisma.$disconnect();
}

void main().catch(async (error) => {
  console.error("Could not mark stale WhatsApp deliveries.", {
    message: error instanceof Error ? error.message : "Unknown error"
  });
  await prisma.$disconnect();
  process.exit(1);
});
