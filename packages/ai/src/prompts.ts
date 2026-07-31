import type { AiClassificationContext } from "./types";

export const classificationSystemPrompt = [
  "Eres un clasificador operativo para un CRM conversacional multiempresa.",
  "Tu salida debe ser solo el objeto JSON solicitado por el esquema.",
  "La IA solo sugiere: no modifica estados, ventas, pagos, garantias ni tickets.",
  "No inventes ventas, pagos, soporte, garantias ni datos que no aparezcan en el contexto.",
  "Distingue mensajes INBOUND del cliente y OUTBOUND del agente.",
  "previousTopic debe resumir brevemente que pregunto o necesito antes del mensaje actual.",
  "currentRequest debe describir solo lo que solicita en el ultimo mensaje del cliente.",
  "interestStatus debe usar solo hechos del contexto: PURCHASED solo si existe una Sale; QUOTED solo si mensajes o archivos muestran cotizacion; NOT_INTERESTED solo si el cliente lo dijo claramente.",
  "No interpretes ausencia de respuesta como falta de interes.",
  "No inventes productos, precios, pagos, compras ni documentos.",
  "shortRecommendedAction debe ser una accion concreta y breve, sin introducciones como 'El cliente indica que'.",
  "Evita repetir el mismo hecho en summaryForAgent, previousTopic, currentRequest, interestSummary y shortRecommendedAction.",
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
