export function getWhatsappSettingsFeedback(params?: {
  saved?: string;
  error?: string;
}) {
  if (params?.saved === "tenant-alerts") {
    return {
      tone: "success" as const,
      text: "Configuracion de alertas guardada correctamente."
    };
  }

  if (params?.saved === "my-whatsapp-preferences") {
    return {
      tone: "success" as const,
      text: "Preferencias de WhatsApp guardadas correctamente."
    };
  }

  const errorMessages: Record<string, string> = {
    "invalid-alert-account":
      "La cuenta WhatsApp seleccionada no es valida para este tenant.",
    "viewer-whatsapp-alerts":
      "El rol VIEWER no puede activar alertas operativas por WhatsApp.",
    "invalid-timezone": "La zona horaria no es valida.",
    "quiet-hours-required":
      "El horario silencioso requiere hora de inicio y fin.",
    "invalid-quiet-hours": "El horario silencioso debe usar formato HH:mm.",
    "invalid-severity": "La severidad minima seleccionada no es valida."
  };
  const errorText = params?.error ? errorMessages[params.error] : null;

  return errorText
    ? {
        tone: "error" as const,
        text: errorText
      }
    : null;
}
