import { LogIn, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth";

import { loginAction } from "./actions";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

function getErrorMessage(error?: string) {
  if (error === "missing") {
    return "Escribe email y contrasena para continuar.";
  }

  if (error === "invalid") {
    return "Email o contrasena incorrectos.";
  }

  return null;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getCurrentSession();

  if (session) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const errorMessage = getErrorMessage(params?.error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/35 px-5 py-10">
      <section className="w-full max-w-md rounded-md border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <ShieldCheck aria-hidden="true" className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">Acceso a JAHF Comm</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Ingresa con un usuario que tenga membresia activa en un tenant.
        </p>

        {errorMessage ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        <form action={loginAction} className="mt-6 grid gap-4">
          <label className="grid gap-2 text-sm font-medium">
            Email
            <input
              autoComplete="email"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              name="email"
              required
              type="email"
            />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Contrasena
            <input
              autoComplete="current-password"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              name="password"
              required
              type="password"
            />
          </label>

          <Button className="w-full" type="submit">
            <LogIn aria-hidden="true" className="h-4 w-4" />
            Entrar
          </Button>
        </form>
      </section>
    </main>
  );
}
