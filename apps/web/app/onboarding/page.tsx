import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth";
import { prisma, NotificationSeverity } from "@jahf-comm/db";

import { completeOnboardingAction } from "./actions";

export const dynamic = "force-dynamic";

function maskPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";

  return digits ? `****${digits.slice(-4)}` : "Sin configurar";
}

export default async function OnboardingPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }

  if (!session.tenant) {
    redirect(session.isPlatformAdmin ? "/platform" : "/select-tenant");
  }

  if (session.tenant.onboardingCompletedAt) {
    redirect("/settings");
  }

  const [account, preference] = await Promise.all([
    prisma.whatsAppAccount.findFirst({
      where: { tenantId: session.tenant.id },
      orderBy: { createdAt: "asc" },
      select: {
        displayName: true,
        name: true,
        phoneNumber: true,
        instanceName: true,
        providerInstanceId: true,
        providerAccountId: true
      }
    }),
    prisma.notificationPreference.findUnique({
      where: {
        tenantId_userId: {
          tenantId: session.tenant.id,
          userId: session.user.id
        }
      },
      select: {
        whatsappEnabled: true,
        whatsappPhone: true,
        minimumSeverity: true,
        returningCustomerEnabled: true,
        supportEnabled: true,
        highPriorityEnabled: true,
        negativeSentimentEnabled: true,
        timezone: true
      }
    })
  ]);

  return (
    <main className="min-h-screen bg-muted/35 px-5 py-6 text-foreground md:px-8">
      <div className="mx-auto max-w-5xl">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Onboarding del propietario
          </p>
          <h1 className="mt-1 text-3xl font-semibold">
            Configura {session.tenant.name}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Registra el número comercial de Evolution y el número personal para
            alertas. No se crea instancia real, no se muestra QR y las alertas
            permanecen desactivadas hasta confirmar conexión.
          </p>
        </div>

        <form action={completeOnboardingAction} className="mt-6 grid gap-5">
          <section className="rounded-md border bg-card p-5">
            <h2 className="font-semibold">1. Empresa</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                Nombre
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  defaultValue={session.tenant.name}
                  name="tenantName"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Zona horaria
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  defaultValue={
                    preference?.timezone ?? "America/Mexico_City"
                  }
                  name="timezone"
                  required
                />
              </label>
            </div>
          </section>

          <section className="rounded-md border bg-card p-5">
            <h2 className="font-semibold">2. WhatsApp comercial</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              El instanceName debe coincidir exactamente con la instancia
              configurada en Evolution API.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                Nombre visible
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  defaultValue={account?.displayName ?? account?.name ?? ""}
                  name="displayName"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Número telefónico
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  defaultValue={account?.phoneNumber ?? ""}
                  name="commercialPhone"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Instance name
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  defaultValue={account?.instanceName ?? ""}
                  name="instanceName"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Provider instance ID
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  defaultValue={account?.providerInstanceId ?? ""}
                  name="providerInstanceId"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium md:col-span-2">
                Provider account ID
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  defaultValue={account?.providerAccountId ?? ""}
                  name="providerAccountId"
                />
              </label>
            </div>
          </section>

          <section className="rounded-md border bg-card p-5">
            <h2 className="font-semibold">3. Alertas personales</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                Número personal
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  defaultValue={preference?.whatsappPhone ?? ""}
                  name="personalPhone"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Severidad mínima
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  defaultValue={preference?.minimumSeverity ?? NotificationSeverity.HIGH}
                  name="minimumSeverity"
                >
                  {Object.values(NotificationSeverity).map((severity) => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              {[
                ["whatsappEnabled", "WhatsApp enabled", preference?.whatsappEnabled],
                [
                  "returningCustomerEnabled",
                  "Clientes recurrentes",
                  preference?.returningCustomerEnabled ?? true
                ],
                ["supportEnabled", "Soporte", preference?.supportEnabled ?? true],
                [
                  "highPriorityEnabled",
                  "Prioridad alta",
                  preference?.highPriorityEnabled ?? true
                ],
                [
                  "negativeSentimentEnabled",
                  "Sentimiento negativo",
                  preference?.negativeSentimentEnabled
                ]
              ].map(([name, label, checked]) => (
                <label className="flex items-center gap-2" key={name as string}>
                  <input
                    defaultChecked={Boolean(checked)}
                    name={name as string}
                    type="checkbox"
                  />
                  <span>{label as string}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-md border bg-card p-5">
            <h2 className="font-semibold">4. Confirmación</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Comercial actual: {maskPhone(account?.phoneNumber)} · Alertas
              actuales: {maskPhone(preference?.whatsappPhone)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Las alertas del tenant quedarán vinculadas a la cuenta comercial,
              pero seguirán desactivadas hasta validar la conexión.
            </p>
            <div className="mt-5 flex justify-end">
              <Button type="submit">Completar onboarding</Button>
            </div>
          </section>
        </form>
      </div>
    </main>
  );
}
