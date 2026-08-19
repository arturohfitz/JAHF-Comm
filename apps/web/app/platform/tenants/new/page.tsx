import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requirePlatformAdmin } from "@/lib/auth";

import { createTenantOwnerAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewTenantPage() {
  await requirePlatformAdmin();

  return (
    <main className="min-h-screen bg-muted/35 px-5 py-6 text-foreground md:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Administrador maestro
            </p>
            <h1 className="mt-1 text-3xl font-semibold">Nueva empresa</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Crea el tenant, su propietario y preferencias iniciales sin enviar
              correo ni WhatsApp.
            </p>
          </div>
          <Link href="/platform">
            <Button variant="outline">Volver</Button>
          </Link>
        </div>

        <form
          action={createTenantOwnerAction}
          className="mt-6 grid gap-4 rounded-md border bg-card p-5 md:grid-cols-2"
        >
          <label className="grid gap-2 text-sm font-medium">
            Nombre del negocio
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              name="businessName"
              placeholder="JAHF Demo Cliente"
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Slug
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              name="slug"
              placeholder="jahf-demo-cliente"
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Nombre del propietario
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              name="ownerName"
              placeholder="Propietario"
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Correo del propietario
            <input
              autoComplete="off"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              name="ownerEmail"
              placeholder="owner@example.com"
              required
              type="email"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Contraseña temporal
            <input
              autoComplete="new-password"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              minLength={12}
              name="temporaryPassword"
              required
              type="password"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Zona horaria
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              defaultValue="America/Mexico_City"
              name="timezone"
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-medium md:col-span-2">
            Teléfono personal de alertas
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              name="alertPhone"
              placeholder="+5215551234567"
            />
          </label>
          <div className="flex justify-end md:col-span-2">
            <Button type="submit">Crear empresa y propietario</Button>
          </div>
        </form>
      </div>
    </main>
  );
}
