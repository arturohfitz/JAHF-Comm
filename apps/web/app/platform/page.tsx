import {
  MessageSquare,
  Settings,
  ShieldCheck,
  Users,
  Building2
} from "lucide-react";
import Link from "next/link";

import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { requirePlatformAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { prisma, WhatsAppAccountStatus } from "@jahf-comm/db";

import { enterTenantAction, exitTenantAction } from "./actions";

export const dynamic = "force-dynamic";

function maskPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";

  return digits ? `****${digits.slice(-4)}` : "Sin configurar";
}

function Metric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Building2;
  label: string;
  value: number;
}) {
  return (
    <article className="rounded-md border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
      </div>
    </article>
  );
}

export default async function PlatformPage() {
  const session = await requirePlatformAdmin();
  const [totalTenants, totalUsers, connectedTenants, pendingOnboarding, tenants] =
    await Promise.all([
      prisma.tenant.count(),
      prisma.user.count(),
      prisma.tenant.count({
        where: {
          whatsappAccounts: {
            some: { status: WhatsAppAccountStatus.CONNECTED }
          }
        }
      }),
      prisma.tenant.count({ where: { onboardingCompletedAt: null } }),
      prisma.tenant.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          name: true,
          slug: true,
          onboardingCompletedAt: true,
          memberships: {
            where: { role: "OWNER" },
            take: 1,
            select: {
              user: {
                select: {
                  name: true,
                  email: true,
                  notificationPreferences: {
                    take: 1,
                    select: { whatsappPhone: true }
                  }
                }
              }
            }
          },
          whatsappAccounts: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: {
              displayName: true,
              name: true,
              phoneNumber: true,
              instanceName: true,
              providerInstanceId: true,
              status: true
            }
          },
          messages: {
            orderBy: { sentAt: "desc" },
            take: 1,
            select: { sentAt: true }
          },
          _count: {
            select: {
              contacts: true,
              conversations: true
            }
          }
        }
      })
    ]);

  return (
    <main className="min-h-screen bg-muted/35 px-5 py-6 text-foreground md:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Administrador maestro
          </p>
          <h1 className="mt-1 text-3xl font-semibold">Panel de plataforma</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sesión: {session.user.name ?? session.user.email}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {session.activeTenant ? (
            <form action={exitTenantAction}>
              <Button type="submit" variant="outline">
                Salir del tenant
              </Button>
            </form>
          ) : null}
          <Link href="/platform/tenants/new">
            <Button>Nueva empresa</Button>
          </Link>
          <form action={logoutAction}>
            <Button type="submit" variant="outline">
              Cerrar sesión
            </Button>
          </form>
        </div>
      </header>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Building2} label="Tenants" value={totalTenants} />
        <Metric icon={Users} label="Usuarios" value={totalUsers} />
        <Metric
          icon={MessageSquare}
          label="WhatsApp conectado"
          value={connectedTenants}
        />
        <Metric
          icon={ShieldCheck}
          label="Onboarding pendiente"
          value={pendingOnboarding}
        />
      </section>

      <section className="mt-6 overflow-hidden rounded-md border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="font-semibold">Empresas</h2>
          <Link className="text-sm font-medium text-primary" href="/platform/tenants">
            Ver administración
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-muted/70 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Propietario</th>
                <th className="px-4 py-3 font-medium">WhatsApp comercial</th>
                <th className="px-4 py-3 font-medium">Alertas personales</th>
                <th className="px-4 py-3 font-medium">Datos</th>
                <th className="px-4 py-3 font-medium">Última actividad</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenants.map((tenant) => {
                const account = tenant.whatsappAccounts[0];
                const owner = tenant.memberships[0]?.user;

                return (
                  <tr key={tenant.id}>
                    <td className="px-4 py-4">
                      <div className="font-semibold">{tenant.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {tenant.slug}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div>{owner?.name ?? "Sin propietario"}</div>
                      <div className="text-xs text-muted-foreground">
                        {owner?.email ?? "No disponible"}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div>{maskPhone(account?.phoneNumber)}</div>
                      <div className="text-xs text-muted-foreground">
                        {account?.instanceName ??
                          account?.providerInstanceId ??
                          "Sin instancia"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {account?.status ?? "Sin cuenta"}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {maskPhone(owner?.notificationPreferences[0]?.whatsappPhone)}
                    </td>
                    <td className="px-4 py-4">
                      {tenant._count.contacts} contactos ·{" "}
                      {tenant._count.conversations} conversaciones
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">
                      {formatDate(tenant.messages[0]?.sentAt ?? null)}
                    </td>
                    <td className="px-4 py-4">
                      {tenant.onboardingCompletedAt
                        ? "Onboarding completo"
                        : "Pendiente"}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <form action={enterTenantAction}>
                          <input name="tenantId" type="hidden" value={tenant.id} />
                          <Button size="sm" type="submit">
                            Abrir tenant
                          </Button>
                        </form>
                        <Link href={`/platform/tenants/${tenant.id}`}>
                          <Button size="sm" type="button" variant="outline">
                            <Settings aria-hidden="true" className="h-4 w-4" />
                            Revisar
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
