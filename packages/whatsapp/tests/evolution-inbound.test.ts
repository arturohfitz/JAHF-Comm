import assert from "node:assert/strict";
import test from "node:test";

import { normalizeEvolutionInboundMessage } from "../src/index";

function inboundPayload(fromMe?: boolean) {
  return {
    instance: "jahf-services",
    data: {
      key: {
        id: "message-id",
        remoteJid: "5215512345678@s.whatsapp.net",
        fromMe
      },
      message: {
        conversation: "Hola"
      },
      messageTimestamp: 1760000000
    }
  };
}

test("Evolution normaliza fromMe=true", () => {
  const normalized = normalizeEvolutionInboundMessage(inboundPayload(true));

  assert.equal(normalized.fromMe, true);
});

test("Evolution normaliza fromMe=false", () => {
  const normalized = normalizeEvolutionInboundMessage(inboundPayload(false));

  assert.equal(normalized.fromMe, false);
});

test("Evolution usa fromMe=false cuando no existe", () => {
  const payload = inboundPayload();
  delete payload.data.key.fromMe;
  const normalized = normalizeEvolutionInboundMessage(payload);

  assert.equal(normalized.fromMe, false);
});

test("Evolution extrae nombre de documento y texto factual", () => {
  const normalized = normalizeEvolutionInboundMessage({
    instance: "jahf-services",
    data: {
      key: {
        id: "document-id",
        remoteJid: "5215512345678@s.whatsapp.net",
        fromMe: true
      },
      message: {
        documentMessage: {
          fileName: "Cotizacion_Nexiq.pdf"
        }
      },
      messageTimestamp: 1760000000
    }
  });

  assert.equal(normalized.type, "DOCUMENT");
  assert.equal(normalized.attachmentName, "Cotizacion_Nexiq.pdf");
  assert.equal(normalized.text, "[Documento enviado: Cotizacion_Nexiq.pdf]");
});

test("Evolution conserva caption sobre fallback de imagen", () => {
  const normalized = normalizeEvolutionInboundMessage({
    instance: "jahf-services",
    data: {
      key: {
        id: "image-id",
        remoteJid: "5215512345678@s.whatsapp.net",
        fromMe: true
      },
      message: {
        imageMessage: {
          fileName: "foto.jpg",
          caption: "Foto de evidencia"
        }
      },
      messageTimestamp: 1760000000
    }
  });

  assert.equal(normalized.type, "IMAGE");
  assert.equal(normalized.attachmentName, "foto.jpg");
  assert.equal(normalized.text, "Foto de evidencia");
});
