import { LogIn, Mail, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth";

import { loginAction, requestPasswordRecoveryAction } from "./actions";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    recovery?: string;
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

function getRecoveryMessage(recovery?: string) {
  if (recovery === "missing") {
    return {
      tone: "error" as const,
      text: "Escribe un email valido para solicitar ayuda."
    };
  }

  if (recovery === "error") {
    return {
      tone: "error" as const,
      text: "No se pudo enviar la solicitud. Revisa la configuracion SMTP del servidor."
    };
  }

  if (recovery === "sent") {
    return {
      tone: "success" as const,
      text: "Solicitud enviada al administrador maestro."
    };
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
  const recoveryMessage = getRecoveryMessage(params?.recovery);

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

        <div className="my-6 border-t" />

        <form action={requestPasswordRecoveryAction} className="grid gap-4">
          <div>
            <h2 className="text-base font-semibold">Recuperar contrasena</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Enviaremos la solicitud al administrador maestro para verificar y
              restablecer el acceso.
            </p>
          </div>

          {recoveryMessage ? (
            <p
              className={
                recoveryMessage.tone === "success"
                  ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
                  : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              }
            >
              {recoveryMessage.text}
            </p>
          ) : null}

          <label className="grid gap-2 text-sm font-medium">
            Email de la cuenta
            <input
              autoComplete="email"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              name="recoveryEmail"
              required
              type="email"
            />
          </label>

          <Button className="w-full" type="submit" variant="outline">
            <Mail aria-hidden="true" className="h-4 w-4" />
            Solicitar recuperacion
          </Button>
        </form>
      </section>
    </main>
  );
}
