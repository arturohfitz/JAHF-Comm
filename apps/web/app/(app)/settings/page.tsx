import { prisma } from "@jahf-comm/db";
import Link from "next/link";

import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate } from "@/lib/format";
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
        displayName: true,
        phoneNumber: true,
        provider: true,
        status: true,
        instanceName: true,
        providerInstanceId: true,
        updatedAt: true
      }
    });

    return (
      <>
        <PageHeader
          description="Configuracion inicial del tenant demo. No hay integracion real de WhatsApp en este paso."
          title="Configuracion"
        />
        <section className="mb-5 grid gap-3 md:grid-cols-2">
          <Link
            className="rounded-md border bg-card p-4 transition-colors hover:bg-muted/50"
            href="/settings/whatsapp"
          >
            <h3 className="font-semibold">WhatsApp</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Configurar instanceName y providerInstanceId de Evolution.
            </p>
          </Link>
          <Link
            className="rounded-md border bg-card p-4 transition-colors hover:bg-muted/50"
            href="/settings/webhooks"
          >
            <h3 className="font-semibold">Webhooks</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Revisar ultimos eventos recibidos y su payload seguro.
            </p>
          </Link>
        </section>
        <section className="grid gap-3">
          {accounts.map((account) => (
            <article className="rounded-md border bg-card p-4" key={account.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {account.displayName ?? account.name}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {account.phoneNumber} - {account.provider}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Instance: {account.instanceName ?? "Sin instanceName"} · ID:{" "}
                    {account.providerInstanceId ?? "Sin providerInstanceId"} ·{" "}
                    Actualizada {formatDate(account.updatedAt)}
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
