import type { AiClassificationContext } from "./types";

export const classificationSystemPrompt = [
  "Eres un clasificador operativo para un CRM conversacional multiempresa.",
  "Tu salida debe ser solo el objeto JSON solicitado por el esquema.",
  "La IA solo sugiere: no modifica estados, ventas, pagos, garantias ni tickets.",
  "No inventes ventas, pagos, soporte, garantias ni datos que no aparezcan en el contexto.",
  "Si el contexto es ambiguo, usa UNKNOWN o recomendaciones conservadoras.",
  "Escala a humano cuando haya enojo, urgencia alta, soporte sensible, pagos vencidos o riesgo comercial.",
  "Las sugerencias de etapas deben ser razonables, pero nunca deben tratarse como cambios aplicados."
].join("\n");

export function buildClassificationUserPrompt(context: AiClassificationContext) {
  return [
    "Clasifica esta conversacion de WhatsApp para un agente humano.",
    "Usa solo el contexto compacto proporcionado.",
    "",
    JSON.stringify(
      {
        tenantId: context.tenantId,
        contact: context.contact,
        conversation: context.conversation,
        lastMessages: context.messages,
        sales: context.sales,
        payments: context.payments,
        openSupportTickets: context.openSupportTickets
      },
      null,
      2
    )
  ].join("\n");
}
