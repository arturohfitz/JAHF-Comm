import { Prisma, prisma } from "@jahf-comm/db";
import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { getNotificationQueryScope } from "@/lib/notification-polling";

function readHref(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const href = (metadata as Record<string, unknown>).href;

  return typeof href === "string" && href.startsWith("/inbox") ? href : null;
}

type NotificationSummary = {
  id: string;
  title: string;
  description: string | null;
  isRead: boolean;
  createdAt: Date;
  metadata: Prisma.JsonValue | null;
};

export async function GET() {
  const { tenant, user } = await requireAuth();
  const scope = getNotificationQueryScope({
    tenantId: tenant.id,
    userId: user.id
  });
  const [unreadCount, notifications]: [number, NotificationSummary[]] =
    await Promise.all([
    prisma.notification.count({
      where: {
        ...scope,
        isRead: false
      }
    }),
    prisma.notification.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        description: true,
        isRead: true,
        createdAt: true,
        metadata: true
      }
    })
  ]);

  return NextResponse.json({
    unreadCount,
    notifications: notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      description: notification.description,
      isRead: notification.isRead,
      createdAt: notification.createdAt.toISOString(),
      href: readHref(notification.metadata)
    }))
  });
}
