import { prisma } from "@jahf-comm/db";

import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { getDemoSession } from "@/lib/demo-auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  try {
    const { tenant } = await getDemoSession();

    const accounts = await prisma.whatsAppAccount.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        provider: true,
        status: true
      }
    });

    return (
      <>
        <PageHeader
          description="Configuracion inicial del tenant demo. No hay integracion real de WhatsApp en este paso."
          title="Configuracion"
        />
        <section className="grid gap-3">
          {accounts.map((account) => (
            <article className="rounded-md border bg-card p-4" key={account.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{account.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {account.phoneNumber} - {account.provider}
                  </p>
                </div>
                <StatusBadge value={account.status} />
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
          description="Configuracion inicial del tenant demo. No hay integracion real de WhatsApp en este paso."
          title="Configuracion"
        />
        <DataUnavailable error={error} />
      </>
    );
  }
}
