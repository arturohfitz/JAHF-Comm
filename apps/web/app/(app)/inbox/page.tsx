import {
  ContactStage,
  ConversationStage,
  MessageDirection,
  PaymentStatus,
  prisma,
  SupportStatus
} from "@jahf-comm/db";
import { Bot, CheckCircle2, CircleAlert, Send, UserRound } from "lucide-react";
import Link from "next/link";

import { DataUnavailable } from "@/components/app/data-unavailable";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { getDemoSession } from "@/lib/demo-auth";
import { formatCurrency, formatDate, humanizeEnum } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  createInternalNote,
  updateContactStage,
  updateConversationAssignee,
  updateConversationStage
} from "./actions";

export const dynamic = "force-dynamic";

type InboxPageProps = {
  searchParams?: Promise<{
    conversationId?: string;
  }>;
};

const openSupportStatuses = [
  SupportStatus.OPEN,
  SupportStatus.IN_PROGRESS,
  SupportStatus.WAITING_CUSTOMER
];

const closedConversationStages: ConversationStage[] = [
  ConversationStage.CLOSED,
  ConversationStage.ESCALATED
];

const pendingPaymentStatuses: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.PARTIAL,
  PaymentStatus.OVERDUE
];

function getConversationIndicator(stage: ConversationStage) {
  if (stage === ConversationStage.ESCALATED) {
    return "bg-red-500";
  }

  if (stage === ConversationStage.CLOSED) {
    return "bg-zinc-400";
  }

  return "bg-emerald-500";
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/35 px-4 py-5 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  try {
    const params = await searchParams;
    const requestedConversationId = params?.conversationId;
    const { tenant } = await getDemoSession();

    const [conversations, memberships] = await Promise.all([
      prisma.conversation.findMany({
        where: { tenantId: tenant.id },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          stage: true,
          lastMessageAt: true,
          contact: {
            select: {
              name: true,
              phoneNumber: true,
              normalizedPhoneNumber: true,
              stage: true
            }
          },
          messages: {
            orderBy: { sentAt: "desc" },
            take: 1,
            select: {
              text: true,
              type: true,
              sentAt: true
            }
          },
          aiClassifications: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              urgency: true,
              detectedIntent: true
            }
          },
          _count: {
            select: {
              messages: true
            }
          }
        }
      }),
      prisma.membership.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "asc" },
        select: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          }
        }
      })
    ]);

    const selectedConversationId = requestedConversationId
      ? conversations.some((conversation) => conversation.id === requestedConversationId)
        ? requestedConversationId
        : null
      : conversations[0]?.id ?? null;

    const selectedConversation = selectedConversationId
      ? await prisma.conversation.findFirst({
          where: {
            id: selectedConversationId,
            tenantId: tenant.id
          },
          select: {
            id: true,
            stage: true,
            subject: true,
            assignedUserId: true,
            lastMessageAt: true,
            createdAt: true,
            contact: {
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
            },
            assignedUser: {
              select: {
                id: true,
                name: true,
                email: true
              }
            },
            messages: {
              orderBy: { sentAt: "asc" },
              select: {
                id: true,
                direction: true,
                type: true,
                text: true,
                sentAt: true
              }
            },
            sales: {
              orderBy: { soldAt: "desc" },
              select: {
                id: true,
                product: true,
                amountCents: true,
                currency: true,
                status: true,
                soldAt: true
              }
            },
            supportTickets: {
              where: {
                status: {
                  in: openSupportStatuses
                }
              },
              orderBy: { openedAt: "desc" },
              select: {
                id: true,
                title: true,
                status: true,
                priority: true,
                openedAt: true
              }
            },
            aiClassifications: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                detectedIntent: true,
                urgency: true,
                confidence: true,
                summary: true,
                recommendedAction: true,
                createdAt: true
              }
            },
            customerEvents: {
              orderBy: { createdAt: "desc" },
              take: 20,
              select: {
                id: true,
                type: true,
                title: true,
                description: true,
                createdAt: true,
                actor: {
                  select: {
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        })
      : null;

    const contactPayments = selectedConversation
      ? await prisma.payment.findMany({
          where: {
            tenantId: tenant.id,
            contactId: selectedConversation.contact.id
          },
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
          select: {
            id: true,
            amountDueCents: true,
            amountPaidCents: true,
            currency: true,
            dueDate: true,
            status: true
          }
        })
      : [];

    const lastAiClassification = selectedConversation?.aiClassifications[0];
    const salesTotal = selectedConversation?.sales.reduce(
      (total, sale) => total + sale.amountCents,
      0
    ) ?? 0;
    const pendingPaymentsTotal = contactPayments
      .filter((payment) =>
        pendingPaymentStatuses.includes(payment.status)
      )
      .reduce(
        (total, payment) =>
          total + Math.max(payment.amountDueCents - payment.amountPaidCents, 0),
        0
      );
    const timeline = [
      ...(lastAiClassification
        ? [
            {
              id: `ai-${lastAiClassification.id}`,
              title: "IA clasificada",
              description: `${lastAiClassification.detectedIntent} · ${lastAiClassification.urgency}`,
              createdAt: lastAiClassification.createdAt,
              actor: "Sistema"
            }
          ]
        : []),
      ...(selectedConversation?.customerEvents.map((event) => ({
        id: event.id,
        title: event.title,
        description: event.description ?? humanizeEnum(event.type),
        createdAt: event.createdAt,
        actor: event.actor?.name ?? event.actor?.email ?? "Sistema"
      })) ?? [])
    ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    return (
      <>
        <PageHeader
          description="Vista operativa para revisar conversaciones, historial del cliente y cambios manuales de estatus."
          title="Inbox"
        />
        <section className="grid min-h-[720px] gap-4 xl:h-[calc(100vh-11rem)] xl:grid-cols-[330px_minmax(0,1fr)_360px]">
          <aside className="overflow-hidden rounded-md border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Conversaciones</h2>
              <p className="text-xs text-muted-foreground">
                {conversations.length} conversaciones demo
              </p>
            </div>
            <div className="max-h-[680px] overflow-y-auto xl:max-h-[calc(100vh-15rem)]">
              {conversations.length === 0 ? (
                <div className="p-4">
                  <EmptyState>No hay conversaciones registradas.</EmptyState>
                </div>
              ) : (
                conversations.map((conversation) => {
                  const lastMessage = conversation.messages[0];
                  const ai = conversation.aiClassifications[0];
                  const selected = conversation.id === selectedConversation?.id;

                  return (
                    <Link
                      className={cn(
                        "block border-b px-4 py-3 transition-colors hover:bg-muted/60",
                        selected && "bg-primary/10"
                      )}
                      href={`/inbox?conversationId=${conversation.id}`}
                      key={conversation.id}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-1 h-2.5 w-2.5 rounded-full",
                            getConversationIndicator(conversation.stage)
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">
                                {conversation.contact.name ??
                                  conversation.contact.phoneNumber ??
                                  conversation.contact.normalizedPhoneNumber}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {conversation.contact.phoneNumber ??
                                  conversation.contact.normalizedPhoneNumber}
                              </p>
                            </div>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {formatDate(lastMessage?.sentAt ?? conversation.lastMessageAt)}
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                            {lastMessage?.text ??
                              (lastMessage?.type
                                ? humanizeEnum(lastMessage.type)
                                : "Sin mensajes registrados")}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <StatusBadge value={conversation.stage} />
                            <StatusBadge value={conversation.contact.stage} />
                            {ai ? <StatusBadge value={ai.urgency} /> : null}
                            <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
                              {conversation._count.messages} mensajes
                            </span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </aside>

          <main className="flex min-h-[620px] flex-col overflow-hidden rounded-md border bg-card">
            {!selectedConversation ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <EmptyState>
                  {requestedConversationId
                    ? "La conversacion seleccionada no existe o no pertenece al tenant demo."
                    : "Selecciona una conversacion para ver el historial."}
                </EmptyState>
              </div>
            ) : (
              <>
                <div className="border-b px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">
                        {selectedConversation.contact.name}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {selectedConversation.contact.phoneNumber ??
                          selectedConversation.contact.normalizedPhoneNumber}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge value={selectedConversation.stage} />
                      <StatusBadge value={selectedConversation.contact.stage} />
                    </div>
                  </div>
                </div>
                <div className="flex-1 space-y-4 overflow-y-auto bg-muted/25 px-5 py-5">
                  {selectedConversation.messages.length === 0 ? (
                    <EmptyState>No hay mensajes en esta conversacion.</EmptyState>
                  ) : (
                    selectedConversation.messages.map((message) => {
                      const inbound = message.direction === MessageDirection.INBOUND;

                      return (
                        <div
                          className={cn(
                            "flex",
                            inbound ? "justify-start" : "justify-end"
                          )}
                          key={message.id}
                        >
                          <div
                            className={cn(
                              "max-w-[78%] rounded-md border px-4 py-3 shadow-sm",
                              inbound
                                ? "bg-background text-foreground"
                                : "bg-primary text-primary-foreground"
                            )}
                          >
                            {message.type !== "TEXT" ? (
                              <p className="mb-1 text-xs font-medium uppercase">
                                {humanizeEnum(message.type)}
                              </p>
                            ) : null}
                            <p className="text-sm leading-6">
                              {message.text ?? "Contenido no disponible"}
                            </p>
                            <p
                              className={cn(
                                "mt-2 text-[11px]",
                                inbound
                                  ? "text-muted-foreground"
                                  : "text-primary-foreground/75"
                              )}
                            >
                              {formatDate(message.sentAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="border-t bg-background p-4">
                  <div className="rounded-md border bg-muted/35 p-3">
                    <textarea
                      className="min-h-20 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                      disabled
                      placeholder="Respuesta deshabilitada en esta demo"
                    />
                    <div className="mt-3 flex justify-end">
                      <Button disabled type="button">
                        <Send className="h-4 w-4" />
                        Enviar no disponible en demo
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </main>

          <aside className="space-y-4 overflow-y-auto rounded-md border bg-card p-4 xl:max-h-[calc(100vh-11rem)]">
            {!selectedConversation ? (
              <EmptyState>Sin ficha de cliente para mostrar.</EmptyState>
            ) : (
              <>
                <section className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                      <UserRound className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">
                        {selectedConversation.contact.name}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {selectedConversation.contact.phoneNumber ??
                          selectedConversation.contact.normalizedPhoneNumber}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {selectedConversation.contact.email ?? "Sin email"}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2 text-sm">
                    <InfoRow label="Cliente">
                      <StatusBadge value={selectedConversation.contact.stage} />
                    </InfoRow>
                    <InfoRow label="Conversacion">
                      <StatusBadge value={selectedConversation.stage} />
                    </InfoRow>
                    <InfoRow label="Asignado">
                      {selectedConversation.assignedUser?.name ??
                        selectedConversation.assignedUser?.email ??
                        "Sin asignar"}
                    </InfoRow>
                  </div>
                </section>

                <section className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">Controles manuales</h3>
                  <form action={updateContactStage} className="space-y-2">
                    <input
                      name="conversationId"
                      type="hidden"
                      value={selectedConversation.id}
                    />
                    <input
                      name="contactId"
                      type="hidden"
                      value={selectedConversation.contact.id}
                    />
                    <label className="text-xs font-medium text-muted-foreground">
                      Etapa del cliente
                    </label>
                    <div className="flex gap-2">
                      <select
                        className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                        defaultValue={selectedConversation.contact.stage}
                        name="stage"
                      >
                        {Object.values(ContactStage).map((stage) => (
                          <option key={stage} value={stage}>
                            {humanizeEnum(stage)}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" type="submit">
                        Guardar
                      </Button>
                    </div>
                  </form>
                  <form action={updateConversationStage} className="space-y-2">
                    <input
                      name="conversationId"
                      type="hidden"
                      value={selectedConversation.id}
                    />
                    <label className="text-xs font-medium text-muted-foreground">
                      Etapa de conversacion
                    </label>
                    <div className="flex gap-2">
                      <select
                        className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                        defaultValue={selectedConversation.stage}
                        name="stage"
                      >
                        {Object.values(ConversationStage).map((stage) => (
                          <option key={stage} value={stage}>
                            {humanizeEnum(stage)}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" type="submit">
                        Guardar
                      </Button>
                    </div>
                  </form>
                  <form action={updateConversationAssignee} className="space-y-2">
                    <input
                      name="conversationId"
                      type="hidden"
                      value={selectedConversation.id}
                    />
                    <label className="text-xs font-medium text-muted-foreground">
                      Asignacion
                    </label>
                    <div className="flex gap-2">
                      <select
                        className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                        defaultValue={
                          selectedConversation.assignedUserId ?? "none"
                        }
                        name="assignedUserId"
                      >
                        <option value="none">Sin asignar</option>
                        {memberships.map(({ user }) => (
                          <option key={user.id} value={user.id}>
                            {user.name ?? user.email}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" type="submit">
                        Guardar
                      </Button>
                    </div>
                  </form>
                </section>

                <section className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">Resumen comercial</h3>
                  {selectedConversation.sales.length === 0 ? (
                    <EmptyState>No hay ventas registradas.</EmptyState>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <InfoRow label="Ventas">
                        {selectedConversation.sales.length}
                      </InfoRow>
                      <InfoRow label="Total">
                        {formatCurrency(
                          salesTotal,
                          selectedConversation.sales[0]?.currency ?? "MXN"
                        )}
                      </InfoRow>
                      {selectedConversation.sales.slice(0, 2).map((sale) => (
                        <div className="rounded-md border p-3" key={sale.id}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-medium">{sale.product}</p>
                            <StatusBadge value={sale.status} />
                          </div>
                          <p className="mt-1 text-muted-foreground">
                            {formatCurrency(sale.amountCents, sale.currency)} ·{" "}
                            {formatDate(sale.soldAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">Pagos</h3>
                  {contactPayments.length === 0 ? (
                    <EmptyState>No hay pagos registrados.</EmptyState>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <InfoRow label="Saldo pendiente">
                        {formatCurrency(
                          pendingPaymentsTotal,
                          contactPayments[0]?.currency ?? "MXN"
                        )}
                      </InfoRow>
                      {contactPayments.slice(0, 3).map((payment) => (
                        <div className="rounded-md border p-3" key={payment.id}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-medium">
                              {formatCurrency(
                                payment.amountPaidCents,
                                payment.currency
                              )}{" "}
                              /{" "}
                              {formatCurrency(
                                payment.amountDueCents,
                                payment.currency
                              )}
                            </p>
                            <StatusBadge value={payment.status} />
                          </div>
                          <p className="mt-1 text-muted-foreground">
                            Vence: {formatDate(payment.dueDate)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">Soporte abierto</h3>
                  {selectedConversation.supportTickets.length === 0 ? (
                    <EmptyState>No hay tickets abiertos.</EmptyState>
                  ) : (
                    selectedConversation.supportTickets.map((ticket) => (
                      <div className="rounded-md border p-3 text-sm" key={ticket.id}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium">{ticket.title}</p>
                          <StatusBadge value={ticket.priority} />
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {humanizeEnum(ticket.status)} · {formatDate(ticket.openedAt)}
                        </p>
                      </div>
                    ))
                  )}
                </section>

                <section className="space-y-3 border-t pt-4">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Ultima IA demo</h3>
                  </div>
                  {!lastAiClassification ? (
                    <EmptyState>No hay clasificacion IA registrada.</EmptyState>
                  ) : (
                    <div className="space-y-3 rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge value={lastAiClassification.detectedIntent} />
                        <StatusBadge value={lastAiClassification.urgency} />
                      </div>
                      <p>
                        {lastAiClassification.summary ??
                          "Sin resumen para agente."}
                      </p>
                      <p className="text-muted-foreground">
                        Accion recomendada:{" "}
                        {lastAiClassification.recommendedAction ??
                          "Sin accion recomendada."}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Confianza: {Math.round(lastAiClassification.confidence * 100)}%
                      </p>
                    </div>
                  )}
                </section>

                <section className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">Nota interna</h3>
                  <form action={createInternalNote} className="space-y-3">
                    <input
                      name="conversationId"
                      type="hidden"
                      value={selectedConversation.id}
                    />
                    <input
                      name="contactId"
                      type="hidden"
                      value={selectedConversation.contact.id}
                    />
                    <textarea
                      className="min-h-24 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                      maxLength={700}
                      name="note"
                      placeholder="Agregar nota para el equipo"
                      required
                    />
                    <Button size="sm" type="submit">
                      Guardar nota
                    </Button>
                  </form>
                </section>

                <section className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">Linea de tiempo</h3>
                  {timeline.length === 0 ? (
                    <EmptyState>No hay eventos para este cliente.</EmptyState>
                  ) : (
                    <div className="space-y-3">
                      {timeline.map((event) => (
                        <div className="flex gap-3" key={event.id}>
                          <div className="mt-1">
                            {closedConversationStages.includes(
                              selectedConversation.stage
                            ) ? (
                              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <CircleAlert className="h-4 w-4 text-primary" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 rounded-md border p-3 text-sm">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-medium">{event.title}</p>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {formatDate(event.createdAt)}
                              </span>
                            </div>
                            <p className="mt-1 text-muted-foreground">
                              {event.description}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {event.actor}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </aside>
        </section>
      </>
    );
  } catch (error) {
    return (
      <>
        <PageHeader
          description="Vista operativa para revisar conversaciones, historial del cliente y cambios manuales de estatus."
          title="Inbox"
        />
        <DataUnavailable error={error} />
      </>
    );
  }
}

function InfoRow({
  children,
  label
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  );
}
