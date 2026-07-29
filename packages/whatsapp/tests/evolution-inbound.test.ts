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
