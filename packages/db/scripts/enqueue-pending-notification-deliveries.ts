import { config } from "dotenv";

import {
  DELIVER_NOTIFICATION_WHATSAPP_JOB,
  createNotificationDeliveryJobId,
  createNotificationDeliveryQueue
} from "@jahf-comm/shared/queues";

import {
  NotificationChannel,
  NotificationDeliveryStatus,
  prisma
} from "../src/index.js";
import { customerAlertSource } from "../src/customer-alerts.js";
import { getWhatsappAlertRuntimeConfig } from "../src/notification-deliveries.js";

config({ path: [".env", "../../.env"] });

function readArg(name: string) {
  const prefix = `--${name}=`;

  return process.argv
    .slice(2)
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
}

async function main() {
  const tenantId = readArg("tenantId");
  const batchSizeValue = Number(readArg("batchSize") ?? "100");
  const batchSize =
    Number.isFinite(batchSizeValue) && batchSizeValue > 0
      ? Math.min(batchSizeValue, 500)
      : 100;
  const now = new Date();
  const runtime = getWhatsappAlertRuntimeConfig();
  const notifications = await prisma.notification.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      userId: {
        not: null
      },
      metadata: {
        path: ["source"],
        equals: customerAlertSource
      },
      deliveries: {
        none: {
          channel: NotificationChannel.WHATSAPP
        }
      }
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: {
      id: true,
      tenantId: true
    }
  });
  const retryableDeliveries = await prisma.notificationDelivery.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      channel: NotificationChannel.WHATSAPP,
      notification: {
        metadata: {
          path: ["source"],
          equals: customerAlertSource
        }
      },
      OR: [
        {
          status: NotificationDeliveryStatus.PENDING,
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
        },
        {
          status: NotificationDeliveryStatus.FAILED,
          nextAttemptAt: { lte: now },
          attemptCount: { lt: runtime.maxRetries },
          metadata: {
            path: ["retryable"],
            equals: true
          }
        }
      ]
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: {
      tenantId: true,
      notificationId: true
    }
  });
  const queue = createNotificationDeliveryQueue();
  let enqueued = 0;
  const payloads = [
    ...notifications.map((notification) => ({
      tenantId: notification.tenantId,
      notificationId: notification.id,
      channel: "WHATSAPP" as const
    })),
    ...retryableDeliveries.map((delivery) => ({
      tenantId: delivery.tenantId,
      notificationId: delivery.notificationId,
      channel: "WHATSAPP" as const
    }))
  ];

  try {
    for (const payload of payloads) {
      await queue.add(DELIVER_NOTIFICATION_WHATSAPP_JOB, payload, {
        jobId: createNotificationDeliveryJobId(payload)
      });
      enqueued += 1;
    }
  } finally {
    await queue.disconnect();
    await prisma.$disconnect();
  }

  console.log("Pending WhatsApp notification delivery jobs enqueued.", {
    scannedNotifications: notifications.length,
    scannedDeliveries: retryableDeliveries.length,
    enqueued
  });
}

void main().catch(async (error) => {
  console.error("Could not enqueue pending notification deliveries.", {
    message: error instanceof Error ? error.message : "Unknown error"
  });
  await prisma.$disconnect();
  process.exit(1);
});
