"use server";

import {
  AuditAction,
  ContactStage,
  ConversationStage,
  CustomerEventType,
  MembershipRole,
  prisma
} from "@jahf-comm/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth";

const inboxActionRoles = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.AGENT
] as const;

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
}

function isContactStage(value: string): value is ContactStage {
  return Object.values(ContactStage).includes(value as ContactStage);
}

function isConversationStage(value: string): value is ConversationStage {
  return Object.values(ConversationStage).includes(value as ConversationStage);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readContactStageSuggestion(value: unknown) {
  const record = readRecord(value);
  const suggestion = record?.contactStageSuggestion;

  return typeof suggestion === "string" && isContactStage(suggestion)
    ? suggestion
    : null;
}

function readConversationStageSuggestion(value: unknown) {
  const record = readRecord(value);
  const suggestion = record?.conversationStageSuggestion;

  return typeof suggestion === "string" && isConversationStage(suggestion)
    ? suggestion
    : null;
}

function redirectToConversation(conversationId: string) {
  revalidatePath("/inbox");
  redirect(`/inbox?conversationId=${conversationId}`);
}

export async function updateContactStage(formData: FormData) {
  const { tenant, user } = await requireRole(inboxActionRoles);
  const conversationId = getString(formData, "conversationId");
  const contactId = getString(formData, "contactId");
  const nextStage = getString(formData, "stage");

  if (!conversationId || !contactId || !isContactStage(nextStage)) {
    throw new Error("Datos invalidos para actualizar la etapa del contacto.");
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      tenantId: tenant.id,
      contactId
    },
    select: {
      id: true,
      contact: {
        select: {
          id: true,
          name: true,
          stage: true
        }
      }
    }
  });

  if (!conversation) {
    throw new Error("Conversacion no encontrada para este tenant.");
  }

  if (conversation.contact.stage !== nextStage) {
    await prisma.$transaction([
      prisma.contact.update({
        where: {
          tenantId_id: {
            tenantId: tenant.id,
            id: contactId
          }
        },
        data: {
          stage: nextStage
        }
      }),
      prisma.customerEvent.create({
        data: {
          tenantId: tenant.id,
          contactId,
          conversationId,
          actorUserId: user.id,
          type: CustomerEventType.STATUS_CHANGED,
          title: "Etapa del cliente actualizada",
          description: `${conversation.contact.name}: ${conversation.contact.stage} -> ${nextStage}`,
          metadata: {
            entityType: "Contact",
            before: conversation.contact.stage,
            after: nextStage
          }
        }
      }),
      prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: AuditAction.STATUS_CHANGE,
          entityType: "Contact",
          entityId: contactId,
          before: {
            stage: conversation.contact.stage
          },
          after: {
            stage: nextStage
          }
        }
      })
    ]);
  }

  redirectToConversation(conversationId);
}

export async function updateConversationStage(formData: FormData) {
  const { tenant, user } = await requireRole(inboxActionRoles);
  const conversationId = getString(formData, "conversationId");
  const nextStage = getString(formData, "stage");

  if (!conversationId || !isConversationStage(nextStage)) {
    throw new Error("Datos invalidos para actualizar la etapa de conversacion.");
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      tenantId: tenant.id
    },
    select: {
      id: true,
      contactId: true,
      stage: true
    }
  });

  if (!conversation) {
    throw new Error("Conversacion no encontrada para este tenant.");
  }

  if (conversation.stage !== nextStage) {
    await prisma.$transaction([
      prisma.conversation.update({
        where: {
          tenantId_id: {
            tenantId: tenant.id,
            id: conversationId
          }
        },
        data: {
          stage: nextStage
        }
      }),
      prisma.customerEvent.create({
        data: {
          tenantId: tenant.id,
          contactId: conversation.contactId,
          conversationId,
          actorUserId: user.id,
          type: CustomerEventType.STATUS_CHANGED,
          title: "Etapa de conversacion actualizada",
          description: `${conversation.stage} -> ${nextStage}`,
          metadata: {
            entityType: "Conversation",
            before: conversation.stage,
            after: nextStage
          }
        }
      }),
      prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: AuditAction.STATUS_CHANGE,
          entityType: "Conversation",
          entityId: conversationId,
          before: {
            stage: conversation.stage
          },
          after: {
            stage: nextStage
          }
        }
      })
    ]);
  }

  redirectToConversation(conversationId);
}

export async function updateConversationAssignee(formData: FormData) {
  const { tenant, user } = await requireRole(inboxActionRoles);
  const conversationId = getString(formData, "conversationId");
  const rawAssignedUserId = getString(formData, "assignedUserId");
  const assignedUserId = rawAssignedUserId === "none" ? null : rawAssignedUserId;

  if (!conversationId) {
    throw new Error("Conversacion requerida para actualizar asignacion.");
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      tenantId: tenant.id
    },
    select: {
      id: true,
      contactId: true,
      assignedUserId: true
    }
  });

  if (!conversation) {
    throw new Error("Conversacion no encontrada para este tenant.");
  }

  if (assignedUserId) {
    const membership = await prisma.membership.findFirst({
      where: {
        tenantId: tenant.id,
        userId: assignedUserId
      },
      select: {
        id: true
      }
    });

    if (!membership) {
      throw new Error("Usuario no pertenece al tenant actual.");
    }
  }

  if (conversation.assignedUserId !== assignedUserId) {
    await prisma.$transaction([
      prisma.conversation.update({
        where: {
          tenantId_id: {
            tenantId: tenant.id,
            id: conversationId
          }
        },
        data: {
          assignedUserId
        }
      }),
      prisma.customerEvent.create({
        data: {
          tenantId: tenant.id,
          contactId: conversation.contactId,
          conversationId,
          actorUserId: user.id,
          type: CustomerEventType.INTERNAL_NOTE,
          title: "Asignacion actualizada",
          description: assignedUserId
            ? "Conversacion asignada al usuario demo."
            : "Conversacion desasignada.",
          metadata: {
            entityType: "Conversation",
            before: conversation.assignedUserId,
            after: assignedUserId
          }
        }
      }),
      prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: AuditAction.ASSIGNMENT_CHANGE,
          entityType: "Conversation",
          entityId: conversationId,
          before: {
            assignedUserId: conversation.assignedUserId
          },
          after: {
            assignedUserId
          }
        }
      })
    ]);
  }

  redirectToConversation(conversationId);
}

export async function createInternalNote(formData: FormData) {
  const { tenant, user } = await requireRole(inboxActionRoles);
  const conversationId = getString(formData, "conversationId");
  const contactId = getString(formData, "contactId");
  const note = getString(formData, "note").trim();

  if (!conversationId || !contactId || note.length < 2) {
    throw new Error("La nota interna necesita al menos 2 caracteres.");
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      tenantId: tenant.id,
      contactId
    },
    select: {
      id: true,
      contactId: true
    }
  });

  if (!conversation) {
    throw new Error("Conversacion no encontrada para este tenant.");
  }

  await prisma.$transaction(async (tx) => {
    const event = await tx.customerEvent.create({
      data: {
        tenantId: tenant.id,
        contactId,
        conversationId,
        actorUserId: user.id,
        type: CustomerEventType.INTERNAL_NOTE,
        title: "Nota interna",
        description: note,
        metadata: {
          source: "inbox"
        }
      },
      select: {
        id: true
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: AuditAction.CREATE,
        entityType: "CustomerEvent",
        entityId: event.id,
        after: {
          type: CustomerEventType.INTERNAL_NOTE,
          conversationId,
          contactId
        }
      }
    });
  });

  redirectToConversation(conversationId);
}

export async function applyAiContactStageSuggestion(formData: FormData) {
  const { tenant, user } = await requireRole(inboxActionRoles);
  const conversationId = getString(formData, "conversationId");
  const aiClassificationId = getString(formData, "aiClassificationId");

  if (!conversationId || !aiClassificationId) {
    throw new Error("Clasificacion IA requerida para aplicar sugerencia.");
  }

  const classification = await prisma.aIClassification.findFirst({
    where: {
      id: aiClassificationId,
      tenantId: tenant.id,
      conversationId
    },
    select: {
      id: true,
      contactId: true,
      rawResult: true,
      contact: {
        select: {
          name: true,
          stage: true
        }
      }
    }
  });

  if (!classification) {
    throw new Error("Clasificacion IA no encontrada para este tenant.");
  }

  const nextStage = readContactStageSuggestion(classification.rawResult);

  if (!nextStage) {
    throw new Error("La clasificacion IA no tiene sugerencia valida de cliente.");
  }

  if (classification.contact.stage !== nextStage) {
    await prisma.$transaction([
      prisma.contact.update({
        where: {
          tenantId_id: {
            tenantId: tenant.id,
            id: classification.contactId
          }
        },
        data: {
          stage: nextStage
        }
      }),
      prisma.customerEvent.create({
        data: {
          tenantId: tenant.id,
          contactId: classification.contactId,
          conversationId,
          actorUserId: user.id,
          type: CustomerEventType.STATUS_CHANGED,
          title: "Sugerencia IA aplicada al cliente",
          description: `${classification.contact.name}: ${classification.contact.stage} -> ${nextStage}`,
          metadata: {
            entityType: "Contact",
            aiClassificationId: classification.id,
            appliedBy: "user",
            before: classification.contact.stage,
            after: nextStage
          }
        }
      }),
      prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: AuditAction.STATUS_CHANGE,
          entityType: "Contact",
          entityId: classification.contactId,
          before: {
            stage: classification.contact.stage
          },
          after: {
            stage: nextStage,
            source: "ai_suggestion",
            aiClassificationId: classification.id
          }
        }
      })
    ]);
  }

  redirectToConversation(conversationId);
}

export async function applyAiConversationStageSuggestion(formData: FormData) {
  const { tenant, user } = await requireRole(inboxActionRoles);
  const conversationId = getString(formData, "conversationId");
  const aiClassificationId = getString(formData, "aiClassificationId");

  if (!conversationId || !aiClassificationId) {
    throw new Error("Clasificacion IA requerida para aplicar sugerencia.");
  }

  const classification = await prisma.aIClassification.findFirst({
    where: {
      id: aiClassificationId,
      tenantId: tenant.id,
      conversationId
    },
    select: {
      id: true,
      contactId: true,
      rawResult: true,
      conversation: {
        select: {
          stage: true
        }
      }
    }
  });

  if (!classification) {
    throw new Error("Clasificacion IA no encontrada para este tenant.");
  }

  const nextStage = readConversationStageSuggestion(classification.rawResult);

  if (!nextStage) {
    throw new Error(
      "La clasificacion IA no tiene sugerencia valida de conversacion."
    );
  }

  if (classification.conversation.stage !== nextStage) {
    await prisma.$transaction([
      prisma.conversation.update({
        where: {
          tenantId_id: {
            tenantId: tenant.id,
            id: conversationId
          }
        },
        data: {
          stage: nextStage
        }
      }),
      prisma.customerEvent.create({
        data: {
          tenantId: tenant.id,
          contactId: classification.contactId,
          conversationId,
          actorUserId: user.id,
          type: CustomerEventType.STATUS_CHANGED,
          title: "Sugerencia IA aplicada a conversacion",
          description: `${classification.conversation.stage} -> ${nextStage}`,
          metadata: {
            entityType: "Conversation",
            aiClassificationId: classification.id,
            appliedBy: "user",
            before: classification.conversation.stage,
            after: nextStage
          }
        }
      }),
      prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: AuditAction.STATUS_CHANGE,
          entityType: "Conversation",
          entityId: conversationId,
          before: {
            stage: classification.conversation.stage
          },
          after: {
            stage: nextStage,
            source: "ai_suggestion",
            aiClassificationId: classification.id
          }
        }
      })
    ]);
  }

  redirectToConversation(conversationId);
}
