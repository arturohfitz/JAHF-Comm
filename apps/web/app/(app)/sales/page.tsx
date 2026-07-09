import { prisma } from "@jahf-comm/db";

import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { requireAuth } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  try {
    const { tenant } = await requireAuth();

    const sales = await prisma.sale.findMany({
      where: { tenantId: tenant.id },
      orderBy: { soldAt: "desc" },
      select: {
        id: true,
        product: true,
        amountCents: true,
        currency: true,
        soldAt: true,
        status: true,
        contact: { select: { name: true } }
      }
    });

    return (
      <>
        <PageHeader
          description="Ventas demo registradas como datos fuente."
          title="Ventas"
        />
        <section className="grid gap-3">
          {sales.map((sale) => (
            <article className="rounded-md border bg-card p-4" key={sale.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{sale.product}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {sale.contact.name} - {formatDate(sale.soldAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {formatCurrency(sale.amountCents, sale.currency)}
                  </span>
                  <StatusBadge value={sale.status} />
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
          description="Ventas demo registradas como datos fuente."
          title="Ventas"
        />
        <DataUnavailable error={error} />
      </>
    );
  }
}
