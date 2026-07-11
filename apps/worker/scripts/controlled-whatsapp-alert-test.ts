import { prisma } from "@jahf-comm/db";
import { pathToFileURL } from "node:url";

import {
  controlledWhatsappTestConfirmation,
  runControlledWhatsappAlertTest,
  type ControlledWhatsappAlertTestInput,
  type ControlledWhatsappAlertTestMode
} from "../src/controlled-whatsapp-alert-test";

function readArg(argv: string[], name: string) {
  const prefix = `--${name}=`;
  const inline = argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);

  if (inline !== undefined) {
    return inline;
  }

  const index = argv.indexOf(`--${name}`);

  return index >= 0 ? argv[index + 1] : undefined;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(`--${name}`);
}

function readMode(argv: string[]): ControlledWhatsappAlertTestMode {
  const mode = readArg(argv, "mode");

  if (mode === "preflight" || mode === "live") {
    return mode;
  }

  throw new Error("Use --mode preflight or --mode live.");
}

export function readControlledWhatsappCliInput(
  argv = process.argv.slice(2)
): ControlledWhatsappAlertTestInput {
  const mode = readMode(argv);
  const tenantId = readArg(argv, "tenantId");
  const actorUserId = readArg(argv, "actorUserId");
  const targetUserId = readArg(argv, "targetUserId");

  if (!tenantId || !actorUserId || !targetUserId) {
    throw new Error("--tenantId, --actorUserId and --targetUserId are required.");
  }

  return {
    mode,
    tenantId,
    actorUserId,
    targetUserId,
    testRunId: readArg(argv, "testRunId"),
    confirm: readArg(argv, "confirm"),
    confirmDedicatedNoWebhook: hasFlag(argv, "confirmDedicatedNoWebhook")
  };
}

async function main() {
  const result = await runControlledWhatsappAlertTest(
    readControlledWhatsappCliInput()
  );

  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(async (error) => {
    console.error("Controlled WhatsApp alert test failed.", {
      message: error instanceof Error ? error.message : "Unknown error",
      requiredConfirmation: controlledWhatsappTestConfirmation
    });
    await prisma.$disconnect();
    process.exit(1);
  });
}
