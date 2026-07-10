import {
  WhatsAppAccountStatus,
  WhatsAppProvider,
  prisma
} from "@jahf-comm/db";

import { AccessDenied } from "@/components/app/access-denied";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { canManageSettings, requireAuth } from "@/lib/auth";

import {
  createWhatsAppAccount,
  disconnectWhatsAppAccountAction,
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

export default async function WhatsAppSettingsPage() {
  const { tenant, membership } = await requireAuth();

  if (!canManageSettings(membership.role)) {
    return (
      <>
        <PageHeader
          description="Cuentas WhatsApp del tenant actual preparadas para recibir webhooks de Evolution API."
          title="WhatsApp"
        />
        <AccessDenied />
      </>
    );
  }

  try {
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
        providerInstanceId: true,
        instanceName: true,
        createdAt: true,
        updatedAt: true
      }
    });

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
          <Button asChild>
            <a href="#new-whatsapp-account">Agregar cuenta WhatsApp</a>
          </Button>
        </div>

        <section className="grid gap-4">
          <CreateWhatsAppAccountForm />

          {accounts.length === 0 ? (
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

          {accounts.map((account) => (
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
          ))}
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
