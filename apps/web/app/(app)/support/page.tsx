import { prisma } from "@jahf-comm/db";

import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { requireAuth } from "@/lib/auth";
import { formatDate, humanizeEnum } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  try {
    const { tenant } = await requireAuth();

    const tickets = await prisma.supportTicket.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        createdAt: true,
        contact: { select: { name: true } }
      }
    });

    return (
      <>
        <PageHeader
          description="Tickets demo de soporte, configuracion o mantenimiento."
          title="Soporte"
        />
        <section className="grid gap-3">
          {tickets.map((ticket) => (
            <article className="rounded-md border bg-card p-4" key={ticket.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{ticket.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {ticket.contact.name} - {formatDate(ticket.createdAt)}
                  </p>
                  <p className="mt-3 text-sm">{ticket.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md border bg-muted px-2 py-1 text-xs font-medium">
                    {humanizeEnum(ticket.priority)}
                  </span>
                  <StatusBadge value={ticket.status} />
                </div>
              </div>
            </article>
          ))}
        </section>
      </>
    );
  } catch (error) {
    return (
      <>
        <PageHeader
          description="Tickets demo de soporte, configuracion o mantenimiento."
          title="Soporte"
        />
        <DataUnavailable error={error} />
      </>
    );
  }
}
