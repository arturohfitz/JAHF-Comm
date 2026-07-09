import Link from "next/link";
import { LogIn, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/35 px-5 py-10">
      <section className="w-full max-w-md rounded-md border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <ShieldCheck aria-hidden="true" className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">Acceso demo</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Esta pantalla es temporal. Por ahora la aplicacion usa siempre el
          tenant demo JAHF Demo y el usuario admin creado por el seed local.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/dashboard">
            <LogIn aria-hidden="true" className="h-4 w-4" />
            Entrar al dashboard
          </Link>
        </Button>
      </section>
    </main>
  );
}
