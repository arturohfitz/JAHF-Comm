import { prisma } from "@jahf-comm/db";

import {
  controlledWhatsappTestConfirmation,
  runControlledWhatsappAlertTest,
  type ControlledWhatsappAlertTestMode
} from "../src/controlled-whatsapp-alert-test";

function readArg(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv
    .slice(2)
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);

  if (inline !== undefined) {
    return inline;
  }

  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function readMode(): ControlledWhatsappAlertTestMode {
  const mode = readArg("mode");

  if (mode === "preflight" || mode === "live") {
    return mode;
  }

  throw new Error("Use --mode preflight or --mode live.");
}

async function main() {
  const mode = readMode();
  const tenantId = readArg("tenantId");
  const actorUserId = readArg("actorUserId");
  const targetUserId = readArg("targetUserId");

  if (!tenantId || !actorUserId || !targetUserId) {
    throw new Error("--tenantId, --actorUserId and --targetUserId are required.");
  }

  const result = await runControlledWhatsappAlertTest({
    mode,
    tenantId,
    actorUserId,
    targetUserId,
    testRunId: readArg("testRunId"),
    confirm: readArg("confirm"),
    confirmDedicatedNoWebhook: hasFlag("confirmDedicatedNoWebhook")
  });

  console.log(JSON.stringify(result, null, 2));
}

void main().catch(async (error) => {
  console.error("Controlled WhatsApp alert test failed.", {
    message: error instanceof Error ? error.message : "Unknown error",
    requiredConfirmation: controlledWhatsappTestConfirmation
  });
  await prisma.$disconnect();
  process.exit(1);
});
