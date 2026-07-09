import { prisma } from "@jahf-comm/db";

import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { requireAuth } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  try {
    const { tenant } = await requireAuth();

    const payments = await prisma.payment.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amountDueCents: true,
        amountPaidCents: true,
        currency: true,
        dueDate: true,
        status: true,
        reference: true,
        contact: { select: { name: true } }
      }
    });

    return (
      <>
        <PageHeader
          description="Seguimiento inicial de pagos del tenant actual."
          title="Pagos"
        />
        <section className="grid gap-3">
          {payments.map((payment) => (
            <article className="rounded-md border bg-card p-4" key={payment.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{payment.contact.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Referencia {payment.reference ?? "sin referencia"} - Vence{" "}
                    {formatDate(payment.dueDate)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {formatCurrency(payment.amountPaidCents, payment.currency)} /{" "}
                    {formatCurrency(payment.amountDueCents, payment.currency)}
                  </span>
                  <StatusBadge value={payment.status} />
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
          description="Seguimiento inicial de pagos del tenant actual."
          title="Pagos"
        />
        <DataUnavailable error={error} />
      </>
    );
  }
}
