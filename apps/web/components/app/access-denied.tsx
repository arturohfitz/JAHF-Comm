export function AccessDenied() {
  return (
    <section className="rounded-md border border-red-200 bg-red-50 p-5 text-red-950">
      <h3 className="text-base font-semibold">Acceso denegado</h3>
      <p className="mt-2 text-sm leading-6">
        Tu rol actual no tiene permiso para ver o modificar esta seccion.
      </p>
    </section>
  );
}
