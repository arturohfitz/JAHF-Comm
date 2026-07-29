import assert from "node:assert/strict";
import test from "node:test";

import { getWhatsappSettingsFeedback } from "../lib/whatsapp-settings-feedback";

test("settings muestra confirmacion de alertas guardadas", () => {
  assert.deepEqual(getWhatsappSettingsFeedback({ saved: "tenant-alerts" }), {
    tone: "success",
    text: "Configuracion de alertas guardada correctamente."
  });
});

test("settings muestra confirmacion de preferencias guardadas", () => {
  assert.deepEqual(
    getWhatsappSettingsFeedback({ saved: "my-whatsapp-preferences" }),
    {
      tone: "success",
      text: "Preferencias de WhatsApp guardadas correctamente."
    }
  );
});

test("settings muestra errores comprensibles", () => {
  assert.deepEqual(getWhatsappSettingsFeedback({ error: "invalid-timezone" }), {
    tone: "error",
    text: "La zona horaria no es valida."
  });
});
