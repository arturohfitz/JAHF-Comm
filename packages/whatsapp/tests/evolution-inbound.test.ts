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

test("Evolution conserva nombre y caption en imagen outbound", () => {
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
  assert.equal(normalized.text, "[Imagen enviada: foto.jpg]\nComentario: Foto de evidencia");
});

test("Evolution usa recibido para documento inbound con caption", () => {
  const normalized = normalizeEvolutionInboundMessage({
    instance: "jahf-services",
    data: {
      key: {
        id: "inbound-document-id",
        remoteJid: "5215512345678@s.whatsapp.net",
        fromMe: false
      },
      message: {
        documentMessage: {
          fileName: "ficha_motor.pdf",
          caption: "Esta es la información de mi unidad."
        }
      },
      messageTimestamp: 1760000000
    }
  });

  assert.equal(normalized.type, "DOCUMENT");
  assert.equal(normalized.attachmentName, "ficha_motor.pdf");
  assert.equal(
    normalized.text,
    "[Documento recibido: ficha_motor.pdf]\nComentario: Esta es la información de mi unidad."
  );
});

test("Evolution no repite nombre si caption ya contiene fileName", () => {
  const normalized = normalizeEvolutionInboundMessage({
    instance: "jahf-services",
    data: {
      key: {
        id: "caption-filename-id",
        remoteJid: "5215512345678@s.whatsapp.net",
        fromMe: true
      },
      message: {
        documentMessage: {
          fileName: "Cotizacion_Nexiq.pdf",
          caption: "Cotizacion_Nexiq.pdf propuesta solicitada."
        }
      },
      messageTimestamp: 1760000000
    }
  });

  assert.equal(
    normalized.text,
    "[Documento enviado: Cotizacion_Nexiq.pdf]\nComentario: propuesta solicitada."
  );
});
