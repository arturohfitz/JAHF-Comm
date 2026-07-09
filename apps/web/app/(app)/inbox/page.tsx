import { prisma } from "@jahf-comm/db";

import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { getDemoSession } from "@/lib/demo-auth";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  try {
    const { tenant } = await getDemoSession();

    const conversations = await prisma.conversation.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        stage: true,
        lastMessageAt: true,
        contact: {
          select: {
            name: true,
            phoneNumber: true,
            normalizedPhoneNumber: true
          }
        },
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1,
          select: {
            text: true,
            sentAt: true
          }
        },
        _count: {
          select: {
            messages: true
          }
        }
      }
    });

    return (
      <>
        <PageHeader
          description="Visualizacion inicial de conversaciones reales. El envio de mensajes se agregara en una fase posterior."
          title="Inbox"
        />
        <section className="grid gap-3">
          {conversations.map((conversation) => {
            const lastMessage = conversation.messages[0];

            return (
              <article
                className="rounded-md border bg-card p-4 text-card-foreground"
                key={conversation.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">
                      {conversation.contact.name}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {conversation.contact.phoneNumber ??
                        conversation.contact.normalizedPhoneNumber}
                    </p>
                  </div>
                  <StatusBadge value={conversation.stage} />
                </div>
                <p className="mt-4 text-sm leading-6">
                  {lastMessage?.text ?? "Sin mensajes registrados"}
                </p>
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>
                    Ultimo mensaje:{" "}
                    {formatDate(lastMessage?.sentAt ?? conversation.lastMessageAt)}
                  </span>
                  <span>Mensajes: {conversation._count.messages}</span>
                </div>
              </article>
            );
          })}
        </section>
      </>
    );
  } catch (error) {
    return (
      <>
        <PageHeader
          description="Visualizacion inicial de conversaciones reales. El envio de mensajes se agregara en una fase posterior."
          title="Inbox"
        />
        <DataUnavailable error={error} />
      </>
    );
  }
}
