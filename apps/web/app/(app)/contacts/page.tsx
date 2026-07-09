import { prisma } from "@jahf-comm/db";

import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { requireAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  try {
    const { tenant } = await requireAuth();

    const contacts = await prisma.contact.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        normalizedPhoneNumber: true,
        email: true,
        stage: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return (
      <>
        <PageHeader
          description="Clientes y prospectos cargados desde el seed demo."
          title="Contactos"
        />
        <section className="overflow-hidden rounded-md border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b bg-muted/70 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Telefono</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Etapa</th>
                  <th className="px-4 py-3 font-medium">Creacion</th>
                  <th className="px-4 py-3 font-medium">Actualizacion</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {contacts.map((contact) => (
                  <tr className="bg-card" key={contact.id}>
                    <td className="px-4 py-4 font-medium">{contact.name}</td>
                    <td className="px-4 py-4">
                      {contact.phoneNumber ?? contact.normalizedPhoneNumber}
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">
                      {contact.email ?? "Sin email"}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={contact.stage} />
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">
                      {formatDate(contact.createdAt)}
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">
                      {formatDate(contact.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  } catch (error) {
    return (
      <>
        <PageHeader
          description="Clientes y prospectos cargados desde el seed demo."
          title="Contactos"
        />
        <DataUnavailable error={error} />
      </>
    );
  }
}
