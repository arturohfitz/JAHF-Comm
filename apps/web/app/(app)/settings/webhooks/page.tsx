import { prisma } from "@jahf-comm/db";

import { AccessDenied } from "@/components/app/access-denied";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate } from "@/lib/format";
import { canManageSettings, requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

function formatRawPayload(value: unknown) {
  if (!value) {
    return "Sin payload";
  }

  return JSON.stringify(value, null, 2);
}

export default async function WebhookLogsPage() {
  const { tenant, membership } = await requireAuth();

  if (!canManageSettings(membership.role)) {
    return (
      <>
        <PageHeader
          description="Diagnostico seguro de webhooks Evolution recibidos por la aplicacion."
          title="Webhooks"
        />
        <AccessDenied />
      </>
    );
  }

  try {
    const logs = await prisma.webhookLog.findMany({
      where: {
        OR: [{ tenantId: tenant.id }, { tenantId: null }]
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        provider: true,
        eventType: true,
        providerInstanceId: true,
        providerMessageId: true,
        status: true,
        httpStatus: true,
        errorMessage: true,
        rawPayload: true,
        createdAt: true,
        whatsappAccount: {
          select: {
            name: true,
            displayName: true
          }
        }
      }
    });

    return (
      <>
        <PageHeader
          description="Diagnostico seguro de webhooks Evolution recibidos por la aplicacion."
          title="Webhooks"
        />

        <section className="overflow-hidden rounded-md border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Instance</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">HTTP</th>
                  <th className="px-4 py-3 font-medium">Message ID</th>
                  <th className="px-4 py-3 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr className="border-t align-top" key={log.id}>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-4 py-3">{log.provider}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {log.providerInstanceId ?? "Sin instancia"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {log.whatsappAccount?.displayName ??
                          log.whatsappAccount?.name ??
                          "Sin cuenta"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={log.status} />
                    </td>
                    <td className="px-4 py-3">{log.httpStatus}</td>
                    <td className="px-4 py-3">
                      {log.providerMessageId ?? "Sin message id"}
                    </td>
                    <td className="px-4 py-3">
                      {log.errorMessage ? (
                        <span className="text-red-700">{log.errorMessage}</span>
                      ) : (
                        <span className="text-muted-foreground">Sin error</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 grid gap-3">
          {logs.map((log) => (
            <details className="rounded-md border bg-card p-4" key={log.id}>
              <summary className="cursor-pointer text-sm font-medium">
                Raw payload · {log.status} ·{" "}
                {log.providerMessageId ?? log.providerInstanceId ?? log.id}
              </summary>
              <pre className="mt-4 max-h-96 overflow-auto rounded-md bg-secondary p-4 text-xs text-secondary-foreground">
                {formatRawPayload(log.rawPayload)}
              </pre>
            </details>
          ))}
        </section>
      </>
    );
  } catch (error) {
    return (
      <>
        <PageHeader
          description="Diagnostico seguro de webhooks Evolution recibidos por la aplicacion."
          title="Webhooks"
        />
        <DataUnavailable error={error} />
      </>
    );
  }
}
