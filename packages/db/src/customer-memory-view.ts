import {
  CustomerReturnType,
  MemorySummarySource,
  MessageDirection,
  prisma,
  type AIIntent,
  type Urgency
} from "@jahf-comm/db";

type MessageOrder = {
  id: string;
  sentAt: Date;
  createdAt: Date;
};

type CustomerMemoryRecord = {
  id: string;
  contactId: string;
  firstSeenAt: Date | null;
  lastInteractionAt: Date | null;
  previousInteractionAt: Date | null;
  messageCount: number;
  inboundMessageCount: number;
  conversationCount: number;
  hasPreviousInteractions: boolean;
  isReturningCustomer: boolean;
  lastReturnType: CustomerReturnType;
  lastInactivityMinutes: number | null;
  lastReactivatedAt: Date | null;
  salesCount: number;
  hasRegisteredSale: boolean;
  lastSaleAt: Date | null;
  paymentsCount: number;
  openSupportTicketsCount: number;
  commercialSummary: string | null;
  summarySource: MemorySummarySource;
  memoryVersion: number;
  lastIntent: AIIntent | null;
  lastPriority: Urgency | null;
  lastSentiment: string | null;
  recommendedNextAction: string | null;
  lastAIClassificationId: string | null;
  lastAIMessageAt: Date | null;
  lastProcessedMessageId: string | null;
  lastProcessedMessageAt: Date | null;
  updatedAt: Date;
};

export type CustomerMemoryView = {
  id: string;
  contactId: string;
  summary: {
    text: string | null;
    source: MemorySummarySource;
    version: number;
    updatedAt: Date;
  };
  history: {
    firstSeenAt: Date | null;
    lastInteractionAt: Date | null;
    previousInteractionAt: Date | null;
    messageCount: number;
    inboundMessageCount: number;
    conversationCount: number;
    hasPreviousInteractions: boolean;
  };
  returnStatus: {
    isReturningCustomer: boolean;
    returnType: CustomerReturnType;
    inactivityMinutes: number | null;
    lastReactivatedAt: Date | null;
  };
  commercial: {
    hasRegisteredSale: boolean;
    salesCount: number;
    lastSaleAt: Date | null;
    paymentsCount: number;
    openSupportTicketsCount: number;
  };
  classification: {
    intent: AIIntent | null;
    priority: Urgency | null;
    sentiment: string | null;
    recommendedNextAction: string | null;
    lastAIClassificationId: string | null;
    lastAIMessageAt: Date | null;
  };
  processing: {
    lastProcessedMessageId: string | null;
    lastProcessedMessageAt: Date | null;
    isStale: boolean;
  };
};

export type CustomerMemoryBadge = {
  label: string;
  tone: "default" | "success" | "warning" | "danger";
  title?: string;
};

export function canReadCustomerMemoryView(input: {
  sessionTenantId: string | null | undefined;
  contactTenantId: string | null | undefined;
  membershipId: string | null | undefined;
}) {
  return Boolean(
    input.sessionTenantId &&
      input.contactTenantId &&
      input.membershipId &&
      input.sessionTenantId === input.contactTenantId
  );
}

function compareMessageOrder(left: MessageOrder, right: MessageOrder) {
  const sentAtDifference = left.sentAt.getTime() - right.sentAt.getTime();

  if (sentAtDifference !== 0) {
    return sentAtDifference;
  }

  const createdAtDifference = left.createdAt.getTime() - right.createdAt.getTime();

  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return left.id.localeCompare(right.id);
}

function fallbackMessageOrder(input: {
  id: string | null;
  sentAt: Date | null;
}): MessageOrder | null {
  if (!input.sentAt) {
    return null;
  }

  return {
    id: input.id ?? "",
    sentAt: input.sentAt,
    createdAt: input.sentAt
  };
}

function isMemoryStale(input: {
  latestInboundMessage: MessageOrder | null;
  processedMessage: MessageOrder | null;
  lastProcessedMessageId: string | null;
  lastProcessedMessageAt: Date | null;
}) {
  if (!input.latestInboundMessage) {
    return false;
  }

  const processedMessage =
    input.processedMessage ??
    fallbackMessageOrder({
      id: input.lastProcessedMessageId,
      sentAt: input.lastProcessedMessageAt
    });

  if (!processedMessage) {
    return true;
  }

  return compareMessageOrder(input.latestInboundMessage, processedMessage) > 0;
}

export function mapReturnTypeLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    [CustomerReturnType.FIRST_CONTACT]: "Primer contacto",
    [CustomerReturnType.ACTIVE_CONVERSATION]: "Conversacion activa",
    [CustomerReturnType.OPERATIONAL_RETURN]: "Cliente recurrente",
    [CustomerReturnType.COMMERCIAL_REACTIVATION]: "Reactivacion comercial"
  };

  return value ? labels[value] ?? humanizeUnknown(value) : "Sin clasificar";
}

export function mapSummarySourceLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    [MemorySummarySource.HEURISTIC]: "Resumen factual",
    [MemorySummarySource.AI]: "Resumen con IA"
  };

  return value ? labels[value] ?? humanizeUnknown(value) : "Sin fuente";
}

export function mapIntentLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    SALES: "Venta",
    QUOTE: "Cotizacion",
    PAYMENT: "Pago",
    SUPPORT: "Soporte",
    CONFIGURATION: "Configuracion",
    WARRANTY: "Garantia",
    COMPLAINT: "Queja",
    FOLLOW_UP: "Seguimiento",
    INFORMATION: "Informacion",
    SPAM: "Spam",
    UNKNOWN: "Sin clasificar"
  };

  return value ? labels[value] ?? humanizeUnknown(value) : "Sin clasificar";
}

export function mapPriorityLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    LOW: "Baja",
    MEDIUM: "Media",
    HIGH: "Alta",
    URGENT: "Urgente"
  };

  return value ? labels[value] ?? humanizeUnknown(value) : "Sin prioridad";
}

export function mapSentimentLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    POSITIVE: "Positivo",
    NEUTRAL: "Neutral",
    NEGATIVE: "Negativo",
    ANGRY: "Molesto",
    UNKNOWN: "Sin clasificar"
  };

  return value ? labels[value.toUpperCase()] ?? humanizeUnknown(value) : "Sin dato";
}

export function formatInactivity(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) {
    return "Sin dato";
  }

  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  }

  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);

    return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  }

  const days = Math.floor(minutes / (24 * 60));

  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

function humanizeUnknown(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function selectConversationBadges(
  memory: CustomerMemoryView | null | undefined,
  maxBadges = 2
): CustomerMemoryBadge[] {
  if (!memory) {
    return [];
  }

  const badges: CustomerMemoryBadge[] = [];

  if (memory.classification.priority === "URGENT") {
    badges.push({ label: "Urgente", tone: "danger" });
  } else if (memory.classification.priority === "HIGH") {
    badges.push({ label: "Prioridad alta", tone: "warning" });
  }

  if (memory.returnStatus.returnType === CustomerReturnType.COMMERCIAL_REACTIVATION) {
    badges.push({ label: "Reactivacion comercial", tone: "warning" });
  } else if (
    memory.returnStatus.returnType === CustomerReturnType.OPERATIONAL_RETURN
  ) {
    badges.push({ label: "Cliente recurrente", tone: "default" });
  }

  if (memory.commercial.hasRegisteredSale) {
    badges.push({ label: "Venta registrada", tone: "success" });
  }

  if (memory.commercial.openSupportTicketsCount > 0) {
    badges.push({ label: "Soporte abierto", tone: "warning" });
  }

  if (
    memory.classification.sentiment === "NEGATIVE" ||
    memory.classification.sentiment === "ANGRY"
  ) {
    badges.push({ label: "Sentimiento negativo", tone: "danger" });
  }

  return badges.slice(0, maxBadges);
}

export function buildCustomerMemoryView(input: {
  memory: CustomerMemoryRecord | null;
  latestInboundMessage?: MessageOrder | null;
  processedMessage?: MessageOrder | null;
}): CustomerMemoryView | null {
  if (!input.memory) {
    return null;
  }

  const isStale = isMemoryStale({
    latestInboundMessage: input.latestInboundMessage ?? null,
    processedMessage: input.processedMessage ?? null,
    lastProcessedMessageId: input.memory.lastProcessedMessageId,
    lastProcessedMessageAt: input.memory.lastProcessedMessageAt
  });

  return {
    id: input.memory.id,
    contactId: input.memory.contactId,
    summary: {
      text: input.memory.commercialSummary,
      source: input.memory.summarySource,
      version: input.memory.memoryVersion,
      updatedAt: input.memory.updatedAt
    },
    history: {
      firstSeenAt: input.memory.firstSeenAt,
      lastInteractionAt: input.memory.lastInteractionAt,
      previousInteractionAt: input.memory.previousInteractionAt,
      messageCount: input.memory.messageCount,
      inboundMessageCount: input.memory.inboundMessageCount,
      conversationCount: input.memory.conversationCount,
      hasPreviousInteractions: input.memory.hasPreviousInteractions
    },
    returnStatus: {
      isReturningCustomer: input.memory.isReturningCustomer,
      returnType: input.memory.lastReturnType,
      inactivityMinutes: input.memory.lastInactivityMinutes,
      lastReactivatedAt: input.memory.lastReactivatedAt
    },
    commercial: {
      hasRegisteredSale: input.memory.hasRegisteredSale,
      salesCount: input.memory.salesCount,
      lastSaleAt: input.memory.lastSaleAt,
      paymentsCount: input.memory.paymentsCount,
      openSupportTicketsCount: input.memory.openSupportTicketsCount
    },
    classification: {
      intent: input.memory.lastIntent,
      priority: input.memory.lastPriority,
      sentiment: input.memory.lastSentiment,
      recommendedNextAction: input.memory.recommendedNextAction,
      lastAIClassificationId: input.memory.lastAIClassificationId,
      lastAIMessageAt: input.memory.lastAIMessageAt
    },
    processing: {
      lastProcessedMessageId: input.memory.lastProcessedMessageId,
      lastProcessedMessageAt: input.memory.lastProcessedMessageAt,
      isStale
    }
  };
}

const customerMemorySelect = {
  id: true,
  contactId: true,
  firstSeenAt: true,
  lastInteractionAt: true,
  previousInteractionAt: true,
  messageCount: true,
  inboundMessageCount: true,
  conversationCount: true,
  hasPreviousInteractions: true,
  isReturningCustomer: true,
  lastReturnType: true,
  lastInactivityMinutes: true,
  lastReactivatedAt: true,
  salesCount: true,
  hasRegisteredSale: true,
  lastSaleAt: true,
  paymentsCount: true,
  openSupportTicketsCount: true,
  commercialSummary: true,
  summarySource: true,
  memoryVersion: true,
  lastIntent: true,
  lastPriority: true,
  lastSentiment: true,
  recommendedNextAction: true,
  lastAIClassificationId: true,
  lastAIMessageAt: true,
  lastProcessedMessageId: true,
  lastProcessedMessageAt: true,
  updatedAt: true
} satisfies Record<keyof CustomerMemoryRecord, true>;

async function getLatestInboundMessages(input: {
  tenantId: string;
  contactIds: string[];
}) {
  if (input.contactIds.length === 0) {
    return new Map<string, MessageOrder>();
  }

  const messages = await prisma.message.findMany({
    where: {
      tenantId: input.tenantId,
      contactId: {
        in: input.contactIds
      },
      direction: MessageDirection.INBOUND
    },
    orderBy: [
      { contactId: "asc" },
      { sentAt: "desc" },
      { createdAt: "desc" },
      { id: "desc" }
    ],
    select: {
      id: true,
      contactId: true,
      sentAt: true,
      createdAt: true
    }
  });
  const latestByContactId = new Map<string, MessageOrder>();

  for (const message of messages) {
    if (!latestByContactId.has(message.contactId)) {
      latestByContactId.set(message.contactId, message);
    }
  }

  return latestByContactId;
}

async function getProcessedMessages(input: {
  tenantId: string;
  contactIds: string[];
  memories: CustomerMemoryRecord[];
}) {
  const processedMessageIds = input.memories
    .map((memory) => memory.lastProcessedMessageId)
    .filter((id): id is string => Boolean(id));

  if (processedMessageIds.length === 0) {
    return new Map<string, MessageOrder>();
  }

  const messages = await prisma.message.findMany({
    where: {
      tenantId: input.tenantId,
      contactId: {
        in: input.contactIds
      },
      id: {
        in: processedMessageIds
      },
      direction: MessageDirection.INBOUND
    },
    select: {
      id: true,
      sentAt: true,
      createdAt: true
    }
  });

  return new Map(messages.map((message) => [message.id, message]));
}

export async function getCustomerMemoryView(input: {
  tenantId: string;
  contactId: string;
}) {
  const views = await getCustomerMemoryListViews({
    tenantId: input.tenantId,
    contactIds: [input.contactId]
  });

  return views.get(input.contactId) ?? null;
}

export async function getCustomerMemoryListViews(input: {
  tenantId: string;
  contactIds: string[];
}) {
  const contactIds = Array.from(new Set(input.contactIds));

  if (contactIds.length === 0) {
    return new Map<string, CustomerMemoryView>();
  }

  const [memories, latestInboundMessages] = await Promise.all([
    prisma.customerMemory.findMany({
      where: {
        tenantId: input.tenantId,
        contactId: {
          in: contactIds
        }
      },
      select: customerMemorySelect
    }),
    getLatestInboundMessages({
      tenantId: input.tenantId,
      contactIds
    })
  ]);
  const processedMessages = await getProcessedMessages({
    tenantId: input.tenantId,
    contactIds,
    memories
  });
  const views = new Map<string, CustomerMemoryView>();

  for (const memory of memories) {
    const view = buildCustomerMemoryView({
      memory,
      latestInboundMessage: latestInboundMessages.get(memory.contactId) ?? null,
      processedMessage: memory.lastProcessedMessageId
        ? processedMessages.get(memory.lastProcessedMessageId) ?? null
        : null
    });

    if (view) {
      views.set(memory.contactId, view);
    }
  }

  return views;
}
