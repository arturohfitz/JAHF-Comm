import {
  MembershipRole,
  NotificationSeverity,
  WhatsAppAccountStatus,
  WhatsAppProvider,
  prisma
} from "@jahf-comm/db";

import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { canManageSettings, requireAuth } from "@/lib/auth";

import {
  createWhatsAppAccount,
  disconnectWhatsAppAccountAction,
  updateMyWhatsappNotificationPreferenceAction,
  updateTenantWhatsappAlertSettingsAction,
  updateWhatsAppAccountAction
} from "./actions";

export const dynamic = "force-dynamic";

function CreateWhatsAppAccountForm() {
  return (
    <article
      className="rounded-md border bg-card p-5"
      id="new-whatsapp-account"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Agregar cuenta WhatsApp</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            El instanceName debe coincidir exactamente con la instancia
            configurada en Evolution API. Si providerInstanceId se deja vacio,
            se usara el mismo valor de instanceName.
          </p>
        </div>
      </div>

      <form
        action={createWhatsAppAccount}
        className="mt-5 grid gap-4 border-t pt-5 md:grid-cols-2"
      >
        <label className="grid gap-2 text-sm font-medium">
          Nombre visible
          <input
            className="h-10 rounded-md border bg-background px-3 text-sm"
            name="displayName"
            placeholder="JAHF Evolution"
            required
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Telefono
          <input
            className="h-10 rounded-md border bg-background px-3 text-sm"
            name="phoneNumber"
            placeholder="+5215551234567"
            required
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Proveedor
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            defaultValue={WhatsAppProvider.EVOLUTION}
            name="provider"
          >
            {Object.values(WhatsAppProvider).map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Estatus
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            defaultValue={WhatsAppAccountStatus.PENDING}
            name="status"
          >
            {Object.values(WhatsAppAccountStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Instance name
          <input
            className="h-10 rounded-md border bg-background px-3 text-sm"
            name="instanceName"
            placeholder="jahf-evolution"
            required
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Provider instance ID
          <input
            className="h-10 rounded-md border bg-background px-3 text-sm"
            name="providerInstanceId"
            placeholder="jahf-evolution"
          />
        </label>

        <div className="flex items-end md:col-span-2">
          <Button type="submit">Agregar cuenta WhatsApp</Button>
        </div>
      </form>
    </article>
  );
}

function RuntimeStatusBadge({
  mode
}: {
  mode: "DISABLED" | "DRY_RUN" | "LIVE";
}) {
  const label =
    mode === "DISABLED"
      ? "Envio deshabilitado por el servidor"
      : mode === "DRY_RUN"
        ? "Modo simulacion activo"
        : "Envio real habilitado";

  return <StatusBadge value={label} />;
}

function getSafeWhatsappRuntimeState() {
  const enabled = process.env.WHATSAPP_ALERTS_ENABLED === "true";
  const dryRun = process.env.WHATSAPP_ALERTS_DRY_RUN !== "false";

  return {
    enabled,
    dryRun,
    mode: !enabled ? ("DISABLED" as const) : dryRun ? ("DRY_RUN" as const) : ("LIVE" as const)
  };
}

function TenantAlertSettingsForm({
  accounts,
  settings,
  conversationAccountIds
}: {
  accounts: Array<{
    id: string;
    displayName: string | null;
    name: string;
    status: WhatsAppAccountStatus;
    instanceName: string | null;
  }>;
  settings: {
    whatsappAlertsAccountId: string | null;
    whatsappAlertsEnabled: boolean;
  } | null;
  conversationAccountIds: Set<string>;
}) {
  return (
    <article className="rounded-md border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">
            Cuenta de WhatsApp para alertas internas
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Usa una cuenta dedicada. No debe ser la misma cuenta que recibe las
            conversaciones de clientes.
          </p>
        </div>
      </div>

      <form
        action={updateTenantWhatsappAlertSettingsAction}
        className="mt-5 grid gap-4 border-t pt-5 md:grid-cols-2"
      >
        <label className="grid gap-2 text-sm font-medium">
          Cuenta dedicada
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            defaultValue={settings?.whatsappAlertsAccountId ?? ""}
            name="whatsappAlertsAccountId"
          >
            <option value="">Sin cuenta seleccionada</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {(account.displayName ?? account.name)} - {account.status} -{" "}
                {account.instanceName ?? "sin instanceName"}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-3 self-end text-sm font-medium">
          <input
            defaultChecked={settings?.whatsappAlertsEnabled ?? false}
            name="whatsappAlertsEnabled"
            type="checkbox"
          />
          Activar alertas WhatsApp del tenant
        </label>

        <div className="md:col-span-2">
          {settings?.whatsappAlertsAccountId &&
          conversationAccountIds.has(settings.whatsappAlertsAccountId) ? (
            <p className="text-sm font-medium text-destructive">
              La cuenta seleccionada aparece en conversaciones. Usa una cuenta
              dedicada para alertas internas.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              La funcion puede estar configurada, pero el envio real permanece
              controlado por el servidor.
            </p>
          )}
        </div>

        <div className="flex items-end md:col-span-2">
          <Button type="submit">Guardar configuracion</Button>
        </div>
      </form>
    </article>
  );
}

function MyNotificationPreferenceForm({
  role,
  preference
}: {
  role: MembershipRole;
  preference: {
    whatsappEnabled: boolean;
    whatsappPhone: string | null;
    minimumSeverity: NotificationSeverity;
    returningCustomerEnabled: boolean;
    supportEnabled: boolean;
    highPriorityEnabled: boolean;
    negativeSentimentEnabled: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    timezone: string;
    allowUrgentDuringQuietHours: boolean;
  } | null;
}) {
  const isViewer = role === MembershipRole.VIEWER;

  return (
    <article className="rounded-md border bg-card p-5">
      <div>
        <h3 className="text-base font-semibold">
          Mis notificaciones por WhatsApp
        </h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Estas preferencias aplican solo a tu usuario dentro de este tenant.
        </p>
      </div>

      {isViewer ? (
        <p className="mt-5 rounded-md border border-dashed bg-muted/25 p-4 text-sm text-muted-foreground">
          Tu rol VIEWER no recibe alertas operativas por WhatsApp.
        </p>
      ) : (
        <form
          action={updateMyWhatsappNotificationPreferenceAction}
          className="mt-5 grid gap-4 border-t pt-5 md:grid-cols-2"
        >
          <label className="grid gap-2 text-sm font-medium">
            Numero interno
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              defaultValue={preference?.whatsappPhone ?? ""}
              name="whatsappPhone"
              placeholder="+5215512345678"
            />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Severidad minima
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

          {[
            ["whatsappEnabled", "Activar WhatsApp"],
            ["returningCustomerEnabled", "Clientes recurrentes"],
            ["supportEnabled", "Soporte"],
            ["highPriorityEnabled", "Prioridad alta"],
            ["negativeSentimentEnabled", "Sentimiento negativo"],
            ["quietHoursEnabled", "Horario silencioso"],
            ["allowUrgentDuringQuietHours", "Permitir urgentes en horario silencioso"]
          ].map(([name, label]) => (
            <label className="flex items-center gap-3 text-sm font-medium" key={name}>
              <input
                defaultChecked={
                  Boolean(preference?.[name as keyof NonNullable<typeof preference>])
                }
                name={name}
                type="checkbox"
              />
              {label}
            </label>
          ))}

          <label className="grid gap-2 text-sm font-medium">
            Inicio
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              defaultValue={preference?.quietHoursStart ?? "22:00"}
              name="quietHoursStart"
              placeholder="22:00"
            />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Fin
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              defaultValue={preference?.quietHoursEnd ?? "06:00"}
              name="quietHoursEnd"
              placeholder="06:00"
            />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Zona horaria
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              defaultValue={preference?.timezone ?? "America/Mexico_City"}
              name="timezone"
            />
          </label>

          <div className="flex items-end md:col-span-2">
            <Button type="submit">Guardar mis preferencias</Button>
          </div>
        </form>
      )}
    </article>
  );
}

export default async function WhatsAppSettingsPage() {
  const { tenant, membership, user } = await requireAuth();

  try {
    const [accounts, settings, preference, conversationAccounts] =
      await Promise.all([
        prisma.whatsAppAccount.findMany({
          where: { tenantId: tenant.id },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            displayName: true,
            phoneNumber: true,
            provider: true,
            status: true,
            providerInstanceId: true,
            instanceName: true,
            createdAt: true,
            updatedAt: true
          }
        }),
        prisma.tenantNotificationSettings.findUnique({
          where: { tenantId: tenant.id },
          select: {
            whatsappAlertsAccountId: true,
            whatsappAlertsEnabled: true
          }
        }),
        prisma.notificationPreference.findUnique({
          where: {
            tenantId_userId: {
              tenantId: tenant.id,
              userId: user.id
            }
          }
        }),
        prisma.conversation.findMany({
          where: { tenantId: tenant.id },
          distinct: ["whatsappAccountId"],
          select: { whatsappAccountId: true }
        })
      ]);
    const runtime = getSafeWhatsappRuntimeState();
    const canManageTenantSettings = canManageSettings(membership.role);
    const conversationAccountIds = new Set(
      conversationAccounts.map((account) => account.whatsappAccountId)
    );

    return (
      <>
        <PageHeader
          description="Cuentas WhatsApp del tenant actual preparadas para recibir webhooks de Evolution API."
          title="WhatsApp"
        />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Administra las cuentas que Evolution API puede resolver para este
            tenant.
          </p>
          <RuntimeStatusBadge mode={runtime.mode} />
          {canManageTenantSettings ? (
            <Button asChild>
              <a href="#new-whatsapp-account">Agregar cuenta WhatsApp</a>
            </Button>
          ) : null}
        </div>

        <section className="grid gap-4">
          {canManageTenantSettings ? (
            <>
              <TenantAlertSettingsForm
                accounts={accounts}
                conversationAccountIds={conversationAccountIds}
                settings={settings}
              />
              <CreateWhatsAppAccountForm />
            </>
          ) : null}

          <MyNotificationPreferenceForm
            preference={preference}
            role={membership.role}
          />

          {canManageTenantSettings && accounts.length === 0 ? (
            <article className="rounded-md border border-dashed bg-muted/25 p-6">
              <h3 className="text-base font-semibold">
                No hay cuentas WhatsApp configuradas
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Agrega una cuenta para poder guardar el instanceName y
                providerInstanceId que usara el webhook de Evolution API.
              </p>
              <div className="mt-4">
                <Button asChild variant="outline">
                  <a href="#new-whatsapp-account">Agregar cuenta WhatsApp</a>
                </Button>
              </div>
            </article>
          ) : null}

          {canManageTenantSettings ? accounts.map((account) => (
            <article className="rounded-md border bg-card p-5" key={account.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold">
                    {account.displayName ?? account.name}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {account.phoneNumber} - {account.provider}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Instance: {account.instanceName ?? "Sin instanceName"} · ID:{" "}
                    {account.providerInstanceId ?? "Sin providerInstanceId"}
                  </p>
                </div>
                <StatusBadge value={account.status} />
              </div>

              <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Creada</dt>
                  <dd className="font-medium">{formatDate(account.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Actualizada</dt>
                  <dd className="font-medium">{formatDate(account.updatedAt)}</dd>
                </div>
              </dl>

              <form
                action={updateWhatsAppAccountAction}
                className="mt-5 grid gap-4 border-t pt-5 md:grid-cols-2"
              >
                <input name="accountId" type="hidden" value={account.id} />

                <label className="grid gap-2 text-sm font-medium">
                  Nombre
                  <input
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    defaultValue={account.displayName ?? account.name}
                    name="displayName"
                    required
                  />
                </label>

                <label className="grid gap-2 text-sm font-medium">
                  Telefono
                  <input
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    defaultValue={account.phoneNumber}
                    name="phoneNumber"
                    required
                  />
                </label>

                <label className="grid gap-2 text-sm font-medium">
                  Instance name
                  <input
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    defaultValue={account.instanceName ?? ""}
                    name="instanceName"
                    placeholder="demo-evolution-instance"
                  />
                </label>

                <label className="grid gap-2 text-sm font-medium">
                  Provider instance ID
                  <input
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    defaultValue={account.providerInstanceId ?? ""}
                    name="providerInstanceId"
                    placeholder="demo-evolution-instance"
                  />
                </label>

                <label className="grid gap-2 text-sm font-medium">
                  Estatus
                  <select
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    defaultValue={account.status}
                    name="status"
                  >
                    {Object.values(WhatsAppAccountStatus).map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-end">
                  <Button type="submit">Guardar cuenta</Button>
                </div>
              </form>

              {account.status !== WhatsAppAccountStatus.DISCONNECTED ? (
                <form
                  action={disconnectWhatsAppAccountAction}
                  className="mt-3 flex justify-end"
                >
                  <input name="accountId" type="hidden" value={account.id} />
                  <Button type="submit" variant="outline">
                    Desactivar
                  </Button>
                </form>
              ) : null}
            </article>
          )) : null}
        </section>
      </>
    );
  } catch (error) {
    return (
      <>
        <PageHeader
          description="Cuentas WhatsApp del tenant actual preparadas para recibir webhooks de Evolution API."
          title="WhatsApp"
        />
        <DataUnavailable error={error} />
      </>
    );
  }
}
