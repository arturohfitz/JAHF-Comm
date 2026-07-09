import {
  Bell,
  CreditCard,
  Headphones,
  MessageSquare,
  TrendingUp,
  UserCheck,
  Users
} from "lucide-react";
import {
  ContactStage,
  ConversationStage,
  PaymentStatus,
  SupportStatus,
  prisma
} from "@jahf-comm/db";

import { MetricCard } from "@/components/app/metric-card";
import { PageHeader } from "@/components/app/page-header";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  try {
    const { tenant } = await requireAuth();

    const [
      totalContacts,
      openConversations,
      prospects,
      soldCustomers,
      pendingPayments,
      openSupportTickets,
      unreadNotifications
    ] = await Promise.all([
      prisma.contact.count({ where: { tenantId: tenant.id } }),
      prisma.conversation.count({
        where: { tenantId: tenant.id, stage: { not: ConversationStage.CLOSED } }
      }),
      prisma.contact.count({
        where: { tenantId: tenant.id, stage: ContactStage.PROSPECT }
      }),
      prisma.contact.count({
        where: { tenantId: tenant.id, stage: ContactStage.SOLD }
      }),
      prisma.payment.count({
        where: {
          tenantId: tenant.id,
          status: {
            in: [
              PaymentStatus.PENDING,
              PaymentStatus.PARTIAL,
              PaymentStatus.OVERDUE
            ]
          }
        }
      }),
      prisma.supportTicket.count({
        where: {
          tenantId: tenant.id,
          status: {
            in: [
              SupportStatus.OPEN,
              SupportStatus.IN_PROGRESS,
              SupportStatus.WAITING_CUSTOMER
            ]
          }
        }
      }),
      prisma.notification.count({
        where: { tenantId: tenant.id, isRead: false }
      })
    ]);

    return (
      <>
        <PageHeader
          description="Resumen operativo conectado a la base demo de Prisma."
          title="Dashboard"
        />
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={Users}
            label="Total de contactos"
            value={totalContacts}
          />
          <MetricCard
            icon={MessageSquare}
            label="Conversaciones abiertas"
            value={openConversations}
          />
          <MetricCard icon={TrendingUp} label="Prospectos" value={prospects} />
          <MetricCard
            icon={UserCheck}
            label="Clientes vendidos"
            value={soldCustomers}
          />
          <MetricCard
            icon={CreditCard}
            label="Pagos pendientes"
            value={pendingPayments}
          />
          <MetricCard
            icon={Headphones}
            label="Tickets abiertos"
            value={openSupportTickets}
          />
          <MetricCard
            icon={Bell}
            label="Notificaciones no leidas"
            value={unreadNotifications}
          />
        </section>
      </>
    );
  } catch (error) {
    return (
      <>
        <PageHeader
          description="Resumen operativo conectado a la base demo de Prisma."
          title="Dashboard"
        />
        <DataUnavailable error={error} />
      </>
    );
  }
}
