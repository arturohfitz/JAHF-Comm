"use server";

import {
  AuditAction,
  ContactStage,
  ConversationStage,
  CustomerEventType,
  prisma
} from "@jahf-comm/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDemoSession } from "@/lib/demo-auth";

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

function redirectToConversation(conversationId: string) {
  revalidatePath("/inbox");
  redirect(`/inbox?conversationId=${conversationId}`);
}

export async function updateContactStage(formData: FormData) {
  const { tenant, user } = await getDemoSession();
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
  const { tenant, user } = await getDemoSession();
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
  const { tenant, user } = await getDemoSession();
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
      throw new Error("Usuario no pertenece al tenant demo.");
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
  const { tenant, user } = await getDemoSession();
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
