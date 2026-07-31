import { logoutAction } from "@/app/login/actions";
import { clearActiveTenantForSession, requireAuth } from "@/lib/auth";

import { NotificationBell } from "./notification-bell";
import { Sidebar } from "./sidebar";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  async function exitTenantAction() {
    "use server";

    await clearActiveTenantForSession();
  }

  return (
    <div className="min-h-screen bg-muted/35 text-foreground md:flex">
      <div className="md:sticky md:top-0 md:h-screen">
        <Sidebar />
      </div>
      <div className="min-w-0 flex-1">
        {session.isPlatformTenantAccess ? (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900 md:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-medium">
                Modo administrador maestro · Viendo: {session.tenant.name}
              </span>
              <form action={exitTenantAction}>
                <button
                  className="h-8 rounded-md border border-amber-300 bg-white px-3 text-xs font-semibold transition-colors hover:bg-amber-100"
                  type="submit"
                >
                  Salir del tenant
                </button>
              </form>
            </div>
          </div>
        ) : null}
        <header className="sticky top-0 z-10 border-b bg-background/95 px-5 py-4 backdrop-blur md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Tenant actual
              </p>
              <h1 className="text-lg font-semibold">
                {session.tenant.name}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <NotificationBell />
              <div className="rounded-md border bg-card px-3 py-2 text-sm">
                <span className="text-muted-foreground">Usuario:</span>{" "}
                <span className="font-medium">
                  {session.user.name ?? session.user.email}
                </span>
                <span className="ml-2 rounded-md bg-muted px-2 py-1 text-xs font-medium">
                  {session.effectiveRole}
                </span>
              </div>
              <form action={logoutAction}>
                <button
                  className="h-10 rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
                  type="submit"
                >
                  Cerrar sesion
                </button>
              </form>
            </div>
          </div>
        </header>
        <main className="px-5 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
