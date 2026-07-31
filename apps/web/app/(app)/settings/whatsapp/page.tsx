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
import { getWhatsappSettingsFeedback } from "@/lib/whatsapp-settings-feedback";

import {
  createWhatsAppAccount,
  disconnectWhatsAppAccountAction,
  updateMyWhatsappNotificationPreferenceAction,
  updateTenantWhatsappAlertSettingsAction,
  updateWhatsAppAccountAction
} from "./actions";

export const dynamic = "force-dynamic";

const notificationSeverityOptions = Object.values(
  NotificationSeverity
) as NotificationSeverity[];
const whatsappAccountStatusOptions = Object.values(
  WhatsAppAccountStatus
) as WhatsAppAccountStatus[];
const whatsappProviderOptions = Object.values(
  WhatsAppProvider
) as WhatsAppProvider[];

type WhatsAppAccountRow = {
  id: string;
  name: string;
  displayName: string | null;
  phoneNumber: string;
  provider: WhatsAppProvider;
  status: WhatsAppAccountStatus;
  providerInstanceId: string | null;
  instanceName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type TenantAlertSettings = {
  whatsappAlertsAccountId: string | null;
  whatsappAlertsEnabled: boolean;
};

type NotificationPreferenceRow = {
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
};

type NotificationPreferenceFlag =
  | "whatsappEnabled"
  | "returningCustomerEnabled"
  | "supportEnabled"
  | "highPriorityEnabled"
  | "negativeSentimentEnabled"
  | "quietHoursEnabled"
  | "allowUrgentDuringQuietHours";

type ConversationAccountRow = {
  whatsappAccountId: string;
};

type WhatsAppSettingsPageProps = {
  searchParams?: Promise<{
    saved?: string;
    error?: string;
  }>;
};

function FeedbackBanner({
  feedback
}: {
  feedback: ReturnType<typeof getWhatsappSettingsFeedback>;
}) {
  if (!feedback) {
    return null;
  }

  return (
    <div
      className={
        feedback.tone === "success"
          ? "mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          : "mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
      }
    >
      {feedback.text}
    </div>
  );
}

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
            {whatsappProviderOptions.map((provider) => (
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
            {whatsappAccountStatusOptions.map((status) => (
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
    mode: !enabled
      ? ("DISABLED" as const)
      : dryRun
        ? ("DRY_RUN" as const)
        : ("LIVE" as const)
  };
}

function TenantAlertSettingsForm({
  accounts,
  settings,
  conversationAccountIds,
  allowSharedAccount
}: {
  accounts: WhatsAppAccountRow[];
  settings: TenantAlertSettings | null;
  conversationAccountIds: Set<string>;
  allowSharedAccount: boolean;
}) {
  return (
    <article className="rounded-md border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">
            Cuenta de WhatsApp para alertas internas
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {allowSharedAccount
              ? "Modo de cuenta compartida habilitado. La cuenta comercial puede recibir clientes y enviar alertas internas. Los eventos salientes fromMe seran ignorados por el webhook."
              : "Usa una cuenta dedicada. No debe ser la misma cuenta que recibe las conversaciones de clientes."}
          </p>
        </div>
      </div>

      <form
        action={updateTenantWhatsappAlertSettingsAction}
        className="mt-5 grid gap-4 border-t pt-5 md:grid-cols-2"
      >
        <label className="grid gap-2 text-sm font-medium">
          {allowSharedAccount ? "Cuenta comercial compartida" : "Cuenta dedicada"}
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
            <p
              className={
                allowSharedAccount
                  ? "text-sm font-medium text-amber-700"
                  : "text-sm font-medium text-destructive"
              }
            >
              {allowSharedAccount
                ? "La cuenta seleccionada aparece en conversaciones. En modo compartido esto es esperado; el webhook ignorara eventos fromMe y respuestas internas conocidas."
                : "La cuenta seleccionada aparece en conversaciones. Usa una cuenta dedicada para alertas internas."}
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
  preference: NotificationPreferenceRow | null;
}) {
  const isViewer = role === MembershipRole.VIEWER;
  const preferenceFlags: Array<[NotificationPreferenceFlag, string]> = [
    ["whatsappEnabled", "Activar WhatsApp"],
    ["returningCustomerEnabled", "Clientes recurrentes"],
    ["supportEnabled", "Soporte"],
    ["highPriorityEnabled", "Prioridad alta"],
    ["negativeSentimentEnabled", "Sentimiento negativo"],
    ["quietHoursEnabled", "Horario silencioso"],
    [
      "allowUrgentDuringQuietHours",
      "Permitir urgentes en horario silencioso"
    ]
  ];

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
              {notificationSeverityOptions.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </select>
          </label>

          {preferenceFlags.map(([name, label]) => (
            <label
              className="flex items-center gap-3 text-sm font-medium"
              key={name}
            >
              <input
                defaultChecked={Boolean(preference?.[name])}
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

export default async function WhatsAppSettingsPage({
  searchParams
}: WhatsAppSettingsPageProps) {
  const { tenant, effectiveRole, user } = await requireAuth();
  const params = await searchParams;
  const feedback = getWhatsappSettingsFeedback(params);

  try {
    const [accounts, settings, preference, conversationAccounts]: [
      WhatsAppAccountRow[],
      TenantAlertSettings | null,
      NotificationPreferenceRow | null,
      ConversationAccountRow[]
    ] = await Promise.all([
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
          },
          select: {
            whatsappEnabled: true,
            whatsappPhone: true,
            minimumSeverity: true,
            returningCustomerEnabled: true,
            supportEnabled: true,
            highPriorityEnabled: true,
            negativeSentimentEnabled: true,
            quietHoursEnabled: true,
            quietHoursStart: true,
            quietHoursEnd: true,
            timezone: true,
            allowUrgentDuringQuietHours: true
          }
        }),
        prisma.conversation.findMany({
          where: { tenantId: tenant.id },
          distinct: ["whatsappAccountId"],
          select: { whatsappAccountId: true }
        })
      ]);
    const runtime = getSafeWhatsappRuntimeState();
    const allowSharedAccount =
      process.env.WHATSAPP_ALERTS_ALLOW_SHARED_ACCOUNT === "true";
    const canManageTenantSettings = canManageSettings(effectiveRole);
    const conversationAccountIds = new Set(
      conversationAccounts.map((account) => account.whatsappAccountId)
    );

    return (
      <>
        <PageHeader
          description="Cuentas WhatsApp del tenant actual preparadas para recibir webhooks de Evolution API."
          title="WhatsApp"
        />
        <FeedbackBanner feedback={feedback} />

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
                allowSharedAccount={allowSharedAccount}
                accounts={accounts}
                conversationAccountIds={conversationAccountIds}
                settings={settings}
              />
              <CreateWhatsAppAccountForm />
            </>
          ) : null}

          <MyNotificationPreferenceForm
            preference={preference}
            role={effectiveRole}
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

          {canManageTenantSettings
            ? accounts.map((account) => (
                <article
                  className="rounded-md border bg-card p-5"
                  key={account.id}
                >
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
                    {whatsappAccountStatusOptions.map((status) => (
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
              ))
            : null}
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
