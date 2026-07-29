import { prisma } from "@jahf-comm/db";
import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";

type RouteContext = {
  params: Promise<{
    notificationId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { notificationId } = await context.params;
  const { tenant, user } = await requireAuth();

  await prisma.notification.updateMany({
    where: {
      id: notificationId,
      tenantId: tenant.id,
      userId: user.id,
      isRead: false
    },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });

  return NextResponse.json({ ok: true });
}
