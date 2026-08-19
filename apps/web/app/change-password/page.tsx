import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth";

import { changePasswordAction } from "./actions";

export const dynamic = "force-dynamic";

type ChangePasswordPageProps = {
  searchParams?: Promise<{ error?: string }>;
};

function errorMessage(error?: string) {
  if (error === "missing") {
    return "Completa todos los campos.";
  }

  if (error === "short") {
    return "La contraseña nueva debe tener al menos 12 caracteres.";
  }

  if (error === "mismatch") {
    return "La confirmación no coincide.";
  }

  if (error === "current") {
    return "La contraseña actual no es correcta.";
  }

  return null;
}

export default async function ChangePasswordPage({
  searchParams
}: ChangePasswordPageProps) {
  const session = await getCurrentSession();
  const params = await searchParams;
  const message = errorMessage(params?.error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/35 px-4 py-10">
      <section className="w-full max-w-xl rounded-md border bg-card p-8 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <KeyRound aria-hidden="true" className="h-6 w-6" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold">Cambia tu contraseña</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Este paso es obligatorio cuando tu cuenta fue creada con contraseña
          temporal.
        </p>
        {session ? (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
            Usuario: <span className="font-medium">{session.user.email}</span>
          </p>
        ) : null}
        {message ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {message}
          </div>
        ) : null}
        <form action={changePasswordAction} className="mt-6 grid gap-4">
          <label className="grid gap-2 text-sm font-medium">
            Contraseña actual
            <input
              autoComplete="current-password"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              name="currentPassword"
              required
              type="password"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Contraseña nueva
            <input
              autoComplete="new-password"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              minLength={12}
              name="nextPassword"
              required
              type="password"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Confirmar contraseña nueva
            <input
              autoComplete="new-password"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              minLength={12}
              name="confirmPassword"
              required
              type="password"
            />
          </label>
          <Button type="submit">Actualizar contraseña</Button>
        </form>
      </section>
    </main>
  );
}
