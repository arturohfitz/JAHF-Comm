import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requirePlatformAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { prisma } from "@jahf-comm/db";

import { enterTenantAction, updateTenantNameAction } from "../../actions";

export const dynamic = "force-dynamic";

type TenantDetailPageProps = {
  params: Promise<{ tenantId: string }>;
};

function maskPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";

  return digits ? `****${digits.slice(-4)}` : "Sin configurar";
}

export default async function TenantDetailPage({ params }: TenantDetailPageProps) {
  await requirePlatformAdmin();
  const { tenantId } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      onboardingCompletedAt: true,
      memberships: {
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              notificationPreferences: {
                take: 1,
                select: {
                  whatsappEnabled: true,
                  whatsappPhone: true,
                  minimumSeverity: true
                }
              }
            }
          }
        }
      },
      whatsappAccounts: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          displayName: true,
          name: true,
          phoneNumber: true,
          provider: true,
          status: true,
          instanceName: true,
          providerInstanceId: true,
          providerAccountId: true
        }
      },
      notificationSettings: {
        select: {
          whatsappAlertsEnabled: true,
          whatsappAlertsAccountId: true
        }
      },
      _count: {
        select: {
          contacts: true,
          conversations: true,
          sales: true,
          payments: true,
          supportTickets: true
        }
      }
    }
  });

  if (!tenant) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-muted/35 px-5 py-6 text-foreground md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Administrador maestro
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{tenant.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {tenant.slug} · Creado {formatDate(tenant.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <form action={enterTenantAction}>
            <input name="tenantId" type="hidden" value={tenant.id} />
            <Button type="submit">Abrir tenant</Button>
          </form>
          <Link href="/platform">
            <Button variant="outline">Volver</Button>
          </Link>
        </div>
      </div>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <article className="rounded-md border bg-card p-5">
          <h2 className="font-semibold">Configuración</h2>
          <form action={updateTenantNameAction} className="mt-4 grid gap-3">
            <input name="tenantId" type="hidden" value={tenant.id} />
            <label className="grid gap-2 text-sm font-medium">
              Nombre
              <input
                className="h-10 rounded-md border bg-background px-3 text-sm"
                defaultValue={tenant.name}
                name="name"
                required
              />
            </label>
            <Button type="submit" variant="outline">
              Guardar nombre
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            Onboarding:{" "}
            {tenant.onboardingCompletedAt
              ? `completo ${formatDate(tenant.onboardingCompletedAt)}`
              : "pendiente"}
          </p>
        </article>

        <article className="rounded-md border bg-card p-5">
          <h2 className="font-semibold">Datos operativos</h2>
          <dl className="mt-4 grid gap-2 text-sm">
            <div>Contactos: {tenant._count.contacts}</div>
            <div>Conversaciones: {tenant._count.conversations}</div>
            <div>Ventas: {tenant._count.sales}</div>
            <div>Pagos: {tenant._count.payments}</div>
            <div>Tickets: {tenant._count.supportTickets}</div>
          </dl>
        </article>

        <article className="rounded-md border bg-card p-5">
          <h2 className="font-semibold">Alertas internas</h2>
          <p className="mt-4 text-sm">
            Estado global:{" "}
            {tenant.notificationSettings?.whatsappAlertsEnabled
              ? "habilitado"
              : "deshabilitado"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Cuenta:{" "}
            {tenant.notificationSettings?.whatsappAlertsAccountId ??
              "sin cuenta asignada"}
          </p>
        </article>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="rounded-md border bg-card p-5">
          <h2 className="font-semibold">Usuarios</h2>
          <div className="mt-4 grid gap-3">
            {tenant.memberships.map((membership) => (
              <div className="rounded-md border p-3" key={membership.user.id}>
                <div className="font-medium">
                  {membership.user.name ?? membership.user.email}
                </div>
                <div className="text-sm text-muted-foreground">
                  {membership.user.email} · {membership.role}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Alertas:{" "}
                  {maskPhone(
                    membership.user.notificationPreferences[0]?.whatsappPhone
                  )}{" "}
                  ·{" "}
                  {membership.user.notificationPreferences[0]?.whatsappEnabled
                    ? "habilitadas"
                    : "deshabilitadas"}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-md border bg-card p-5">
          <h2 className="font-semibold">WhatsApp comercial</h2>
          <div className="mt-4 grid gap-3">
            {tenant.whatsappAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin cuentas configuradas.
              </p>
            ) : (
              tenant.whatsappAccounts.map((account) => (
                <div className="rounded-md border p-3" key={account.id}>
                  <div className="font-medium">
                    {account.displayName ?? account.name}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {account.provider} · {account.status} ·{" "}
                    {maskPhone(account.phoneNumber)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Instance: {account.instanceName ?? "sin instanceName"} · ID:{" "}
                    {account.providerInstanceId ?? "sin providerInstanceId"} ·
                    Account: {account.providerAccountId ?? "sin providerAccountId"}
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
