export function DataUnavailable({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? error.message
      : "No fue posible consultar la base de datos demo.";

  return (
    <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-amber-950">
      <h3 className="text-base font-semibold">Datos demo no disponibles</h3>
      <p className="mt-2 text-sm leading-6">
        La pantalla ya esta conectada a Prisma, pero necesita que PostgreSQL
        este levantado, las migraciones aplicadas y el seed demo ejecutado.
      </p>
      <p className="mt-3 rounded-md bg-white/70 px-3 py-2 text-xs">
        Error actual: {message}
      </p>
    </section>
  );
}
