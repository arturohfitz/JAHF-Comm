import { Building2 } from "lucide-react";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getCurrentMemberships, getCurrentSession } from "@/lib/auth";

import { selectTenantAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SelectTenantPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }

  if (session.isPlatformAdmin) {
    redirect("/platform");
  }

  if (session.tenant) {
    redirect(
      session.tenant.onboardingCompletedAt ? "/dashboard" : "/onboarding"
    );
  }

  const memberships = await getCurrentMemberships();

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/35 px-4 py-10">
      <section className="w-full max-w-2xl rounded-md border bg-card p-8 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Building2 aria-hidden="true" className="h-6 w-6" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold">Selecciona empresa</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Tu sesión necesita un tenant activo antes de entrar al CRM.
        </p>
        <div className="mt-6 grid gap-3">
          {memberships.map((membership) => (
            <form
              action={selectTenantAction}
              className="flex items-center justify-between gap-4 rounded-md border p-4"
              key={membership.id}
            >
              <input name="tenantId" type="hidden" value={membership.tenant.id} />
              <div>
                <h2 className="font-semibold">{membership.tenant.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {membership.tenant.slug} · {membership.role}
                </p>
              </div>
              <Button type="submit">Entrar</Button>
            </form>
          ))}
        </div>
      </section>
    </main>
  );
}
