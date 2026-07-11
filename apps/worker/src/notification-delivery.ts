import { prepareWhatsappNotificationDelivery } from "@jahf-comm/db/notification-deliveries";
import type { NotificationDeliveryJobPayload } from "@jahf-comm/shared";

export async function processNotificationDeliveryJob(
  payload: NotificationDeliveryJobPayload
) {
  if (payload.channel !== "WHATSAPP") {
    throw new Error(`Unsupported notification delivery channel: ${payload.channel}`);
  }

  return prepareWhatsappNotificationDelivery({
    tenantId: payload.tenantId,
    notificationId: payload.notificationId
  });
}
