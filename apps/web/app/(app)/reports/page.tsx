import { prisma } from "@jahf-comm/db";

import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { humanizeEnum } from "@/lib/format";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

function ReportList({
  title,
  rows
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
}) {
  return (
    <section className="rounded-md border bg-card p-5 text-card-foreground">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin datos.</p>
        ) : (
          rows.map((row) => (
            <div className="flex items-center justify-between gap-4" key={row.label}>
              <span className="text-sm text-muted-foreground">
                {humanizeEnum(row.label)}
              </span>
              <span className="rounded-md bg-muted px-2 py-1 text-sm font-semibold">
                {row.count}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default async function ReportsPage() {
  try {
    const { tenant } = await requireAuth();

    const [
      contactsByStage,
      conversationsByStage,
      paymentsByStatus,
      ticketsByStatus,
      aiIntentions
    ] = await Promise.all([
      prisma.contact.groupBy({
        by: ["stage"],
        where: { tenantId: tenant.id },
        _count: { _all: true },
        orderBy: { stage: "asc" }
      }),
      prisma.conversation.groupBy({
        by: ["stage"],
        where: { tenantId: tenant.id },
        _count: { _all: true },
        orderBy: { stage: "asc" }
      }),
      prisma.payment.groupBy({
        by: ["status"],
        where: { tenantId: tenant.id },
        _count: { _all: true },
        orderBy: { status: "asc" }
      }),
      prisma.supportTicket.groupBy({
        by: ["status"],
        where: { tenantId: tenant.id },
        _count: { _all: true },
        orderBy: { status: "asc" }
      }),
      prisma.aIClassification.groupBy({
        by: ["detectedIntent"],
        where: { tenantId: tenant.id },
        _count: { _all: true },
        orderBy: { detectedIntent: "asc" }
      })
    ]);

    return (
      <>
        <PageHeader
          description="Resumen basico calculado desde datos reales del tenant actual."
          title="Reportes"
        />
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <ReportList
            rows={contactsByStage.map((row) => ({
              label: row.stage,
              count: row._count._all
            }))}
            title="Contactos por etapa"
          />
          <ReportList
            rows={conversationsByStage.map((row) => ({
              label: row.stage,
              count: row._count._all
            }))}
            title="Conversaciones por etapa"
          />
          <ReportList
            rows={paymentsByStatus.map((row) => ({
              label: row.status,
              count: row._count._all
            }))}
            title="Pagos por estatus"
          />
          <ReportList
            rows={ticketsByStatus.map((row) => ({
              label: row.status,
              count: row._count._all
            }))}
            title="Tickets por estatus"
          />
          <ReportList
            rows={aiIntentions.map((row) => ({
              label: row.detectedIntent,
              count: row._count._all
            }))}
            title="Intenciones IA detectadas"
          />
        </div>
      </>
    );
  } catch (error) {
    return (
      <>
        <PageHeader
          description="Resumen basico calculado desde datos reales del tenant actual."
          title="Reportes"
        />
        <DataUnavailable error={error} />
      </>
    );
  }
}
