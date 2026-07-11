import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvolutionSendTextUrl,
  EvolutionOutboundError,
  maskPhoneNumber,
  sendEvolutionText
} from "../src/index";

type FetchCall = {
  url: string;
  init: RequestInit;
};

function jsonResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function successBody(input: { id?: string; status?: string | null } = {}) {
  const status = "status" in input ? input.status : "PENDING";

  return {
    key: {
      remoteJid: "5215551234567@s.whatsapp.net",
      fromMe: true,
      id: input.id ?? "MESSAGE_ID"
    },
    message: {
      conversation: "ok"
    },
    messageTimestamp: "1760000000",
    status
  };
}

function createFetch(response: Response | Error | (() => Response | Promise<Response>)) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });

    if (typeof response === "function") {
      return response();
    }

    if (response instanceof Error) {
      throw response;
    }

    return response;
  };

  return { calls, fetchImpl };
}

function createTimeoutFetch() {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });

    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      });
    });
  }) as typeof fetch;

  return { calls, fetchImpl };
}

function baseInput(fetchImpl: typeof fetch, logger?: Pick<Console, "warn" | "error">) {
  return {
    baseUrl: "https://evolution.local/api",
    apiKey: "test-api-key",
    instanceName: "internal-alerts",
    number: "+52 (55) 1234-5678",
    text: "Alerta interna",
    timeoutMs: 100,
    fetchImpl,
    logger
  };
}

function readPayload(call: FetchCall) {
  assert.equal(typeof call.init.body, "string");
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

async function assertRejectsWithCategory(
  action: () => Promise<unknown>,
  category: string,
  checks: Partial<Pick<EvolutionOutboundError, "retryable" | "deliveryUnknown">> = {}
) {
  await assert.rejects(
    action,
    (error) => {
      assert.ok(error instanceof EvolutionOutboundError);
      assert.equal(error.category, category);

      if ("retryable" in checks) {
        assert.equal(error.retryable, checks.retryable);
      }

      if ("deliveryUnknown" in checks) {
        assert.equal(error.deliveryUnknown, checks.deliveryUnknown);
      }

      return true;
    }
  );
}

test("construye URL con base sin slash", () => {
  assert.equal(
    buildEvolutionSendTextUrl({
      baseUrl: "https://host",
      instanceName: "instance"
    }),
    "https://host/message/sendText/instance"
  );
});

test("construye URL con base con slash", () => {
  assert.equal(
    buildEvolutionSendTextUrl({
      baseUrl: "https://host/",
      instanceName: "instance"
    }),
    "https://host/message/sendText/instance"
  );
});

test("conserva prefijo /api", () => {
  assert.equal(
    buildEvolutionSendTextUrl({
      baseUrl: "https://host/api/",
      instanceName: "instance"
    }),
    "https://host/api/message/sendText/instance"
  );
});

test("codifica instanceName con espacios", () => {
  assert.equal(
    buildEvolutionSendTextUrl({
      baseUrl: "https://host/api",
      instanceName: "internal alerts"
    }),
    "https://host/api/message/sendText/internal%20alerts"
  );
});

test("la ruta termina en /message/sendText/{instance}", () => {
  assert.match(
    buildEvolutionSendTextUrl({
      baseUrl: "https://host",
      instanceName: "alerts"
    }),
    /\/message\/sendText\/alerts$/
  );
});

test("la base URL debe ser http o https", () => {
  assert.throws(
    () =>
      buildEvolutionSendTextUrl({
        baseUrl: "ftp://host",
        instanceName: "alerts"
      }),
    EvolutionOutboundError
  );
});

test("un nombre de instancia malicioso no altera la ruta", () => {
  assert.equal(
    buildEvolutionSendTextUrl({
      baseUrl: "https://host/api",
      instanceName: "../evil/path?x=1"
    }),
    "https://host/api/message/sendText/..%2Fevil%2Fpath%3Fx%3D1"
  );
});

test("agrega encabezado apikey", async () => {
  const { calls, fetchImpl } = createFetch(jsonResponse(successBody()));

  await sendEvolutionText(baseInput(fetchImpl));

  assert.equal(new Headers(calls[0]?.init.headers).get("apikey"), "test-api-key");
});

test("agrega Content-Type correcto", async () => {
  const { calls, fetchImpl } = createFetch(jsonResponse(successBody()));

  await sendEvolutionText(baseInput(fetchImpl));

  assert.equal(
    new Headers(calls[0]?.init.headers).get("Content-Type"),
    "application/json"
  );
});

test("utiliza payload exacto de Evolution API 2.3.7", async () => {
  const { calls, fetchImpl } = createFetch(jsonResponse(successBody()));

  await sendEvolutionText(baseInput(fetchImpl));

  assert.deepEqual(readPayload(calls[0]!), {
    number: "525512345678",
    text: "Alerta interna"
  });
});

test("el payload contiene number y text en el nivel raiz", async () => {
  const { calls, fetchImpl } = createFetch(jsonResponse(successBody()));

  await sendEvolutionText(baseInput(fetchImpl));

  const payload = readPayload(calls[0]!);
  assert.equal(payload.number, "525512345678");
  assert.equal(payload.text, "Alerta interna");
});

test("el payload no contiene textMessage", async () => {
  const { calls, fetchImpl } = createFetch(jsonResponse(successBody()));

  await sendEvolutionText(baseInput(fetchImpl));

  assert.equal("textMessage" in readPayload(calls[0]!), false);
});

test("no agrega ambas variantes de payload", async () => {
  const { calls, fetchImpl } = createFetch(jsonResponse(successBody()));

  await sendEvolutionText(baseInput(fetchImpl));

  const payload = readPayload(calls[0]!);
  assert.deepEqual(Object.keys(payload).sort(), ["number", "text"]);
});

test("incluye delay y linkPreview cuando se solicitan", async () => {
  const { calls, fetchImpl } = createFetch(jsonResponse(successBody()));

  await sendEvolutionText({
    ...baseInput(fetchImpl),
    delay: 500,
    linkPreview: false
  });

  assert.deepEqual(readPayload(calls[0]!), {
    number: "525512345678",
    text: "Alerta interna",
    delay: 500,
    linkPreview: false
  });
});

test("normaliza telefono", async () => {
  const { calls, fetchImpl } = createFetch(jsonResponse(successBody()));

  await sendEvolutionText({
    ...baseInput(fetchImpl),
    number: "52 55 9999 0000@s.whatsapp.net"
  });

  assert.equal(readPayload(calls[0]!).number, "525599990000");
});

test("rechaza telefono invalido", async () => {
  const { fetchImpl } = createFetch(jsonResponse(successBody()));

  await assertRejectsWithCategory(
    () => sendEvolutionText({ ...baseInput(fetchImpl), number: "abc" }),
    "DESTINATION_INVALID",
    { retryable: false }
  );
});

test("rechaza texto vacio", async () => {
  const { fetchImpl } = createFetch(jsonResponse(successBody()));

  await assertRejectsWithCategory(
    () => sendEvolutionText({ ...baseInput(fetchImpl), text: "   " }),
    "VALIDATION"
  );
});

test("rechaza texto demasiado largo", async () => {
  const { fetchImpl } = createFetch(jsonResponse(successBody()));

  await assertRejectsWithCategory(
    () => sendEvolutionText({ ...baseInput(fetchImpl), text: "x".repeat(4097) }),
    "VALIDATION"
  );
});

test("respuesta HTTP 201 extrae key.id", async () => {
  const { fetchImpl } = createFetch(jsonResponse(successBody({ id: "ABC123" })));

  const result = await sendEvolutionText(baseInput(fetchImpl));

  assert.equal(result.providerMessageId, "ABC123");
  assert.equal(result.httpStatus, 201);
});

test("status PENDING se conserva", async () => {
  const { fetchImpl } = createFetch(jsonResponse(successBody({ status: "PENDING" })));

  const result = await sendEvolutionText(baseInput(fetchImpl));

  assert.equal(result.providerStatus, "PENDING");
});

test("conserva providerStatus null si no viene string", async () => {
  const { fetchImpl } = createFetch(jsonResponse(successBody({ status: null })));

  const result = await sendEvolutionText(baseInput(fetchImpl));

  assert.equal(result.providerStatus, null);
});

test("respuesta 201 sin key.id produce INVALID_PROVIDER_RESPONSE", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ key: {}, status: "PENDING" }));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "INVALID_PROVIDER_RESPONSE",
    { deliveryUnknown: true }
  );
});

test("maneja respuesta 400", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ message: "bad payload" }, 400));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "PERMANENT_PROVIDER_ERROR",
    { retryable: false }
  );
});

test("maneja 400 de destino invalido", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ message: "invalid number" }, 400));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "DESTINATION_INVALID",
    { retryable: false }
  );
});

test("maneja 401", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ message: "unauthorized" }, 401));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "AUTHENTICATION",
    { retryable: false }
  );
});

test("maneja 403", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ message: "forbidden" }, 403));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "AUTHENTICATION",
    { retryable: false }
  );
});

test("maneja 404", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ message: "not found" }, 404));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "INSTANCE_NOT_FOUND",
    { retryable: false }
  );
});

test("maneja 429 como retryable", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ message: "rate limit" }, 429));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "RATE_LIMITED",
    { retryable: true }
  );
});

test("maneja 500 conforme a estrategia documentada", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ message: "server error" }, 500));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "TRANSIENT_PROVIDER_ERROR",
    { retryable: true }
  );
});

test("maneja 502", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ message: "bad gateway" }, 502));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "TRANSIENT_PROVIDER_ERROR",
    { retryable: true }
  );
});

test("maneja 503", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ message: "unavailable" }, 503));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "TRANSIENT_PROVIDER_ERROR",
    { retryable: true }
  );
});

test("maneja 504", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ message: "gateway timeout" }, 504));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "TRANSIENT_PROVIDER_ERROR",
    { retryable: true }
  );
});

test("timeout produce TIMEOUT_UNKNOWN", async () => {
  const { fetchImpl } = createTimeoutFetch();

  await assertRejectsWithCategory(
    () => sendEvolutionText({ ...baseInput(fetchImpl), timeoutMs: 1 }),
    "TIMEOUT_UNKNOWN"
  );
});

test("timeout queda deliveryUnknown true", async () => {
  const { fetchImpl } = createTimeoutFetch();

  await assertRejectsWithCategory(
    () => sendEvolutionText({ ...baseInput(fetchImpl), timeoutMs: 1 }),
    "TIMEOUT_UNKNOWN",
    { deliveryUnknown: true }
  );
});

test("timeout no queda marcado automaticamente como retryable", async () => {
  const { fetchImpl } = createTimeoutFetch();

  await assertRejectsWithCategory(
    () => sendEvolutionText({ ...baseInput(fetchImpl), timeoutMs: 1 }),
    "TIMEOUT_UNKNOWN",
    { retryable: false }
  );
});

test("JSON invalido produce INVALID_PROVIDER_RESPONSE", async () => {
  const { fetchImpl } = createFetch(
    new Response("not-json", {
      status: 201,
      headers: { "Content-Type": "application/json" }
    })
  );

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "INVALID_PROVIDER_RESPONSE"
  );
});

test("HTTP 2xx sin estructura esperada no afirma envio exitoso", async () => {
  const { fetchImpl } = createFetch(jsonResponse({ ok: true }, 202));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "INVALID_PROVIDER_RESPONSE",
    { deliveryUnknown: true }
  );
});

test("error de red produce NETWORK_ERROR", async () => {
  const { fetchImpl } = createFetch(new Error("ECONNRESET secret text"));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "NETWORK_ERROR",
    { retryable: true }
  );
});

test("no se imprime API key en logs", async () => {
  const logs: unknown[] = [];
  const logger = {
    warn: (...args: unknown[]) => logs.push(args),
    error: (...args: unknown[]) => logs.push(args)
  };
  const { fetchImpl } = createFetch(jsonResponse({ message: "unauthorized" }, 401));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl, logger)),
    "AUTHENTICATION"
  );

  assert.equal(JSON.stringify(logs).includes("test-api-key"), false);
});

test("el telefono aparece enmascarado en logs", async () => {
  const logs: unknown[] = [];
  const logger = {
    warn: (...args: unknown[]) => logs.push(args),
    error: (...args: unknown[]) => logs.push(args)
  };
  const { fetchImpl } = createFetch(jsonResponse({ message: "bad payload" }, 400));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl, logger)),
    "PERMANENT_PROVIDER_ERROR"
  );

  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes("525512345678"), false);
  assert.ok(serialized.includes(maskPhoneNumber("525512345678")));
});

test("el texto completo no aparece en logs", async () => {
  const logs: unknown[] = [];
  const logger = {
    warn: (...args: unknown[]) => logs.push(args),
    error: (...args: unknown[]) => logs.push(args)
  };
  const { fetchImpl } = createFetch(jsonResponse({ message: "bad payload" }, 400));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl, logger)),
    "PERMANENT_PROVIDER_ERROR"
  );

  assert.equal(JSON.stringify(logs).includes("Alerta interna"), false);
});

test("dos llamadas del test mock no salen a internet", async () => {
  const { calls, fetchImpl } = createFetch(() => jsonResponse(successBody()));

  await sendEvolutionText(baseInput(fetchImpl));
  await sendEvolutionText(baseInput(fetchImpl));

  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url.startsWith("https://evolution.local")));
});

test("la respuesta raw no se expone al consumidor", async () => {
  const { fetchImpl } = createFetch(
    jsonResponse({
      ...successBody(),
      raw: { private: "hidden" }
    })
  );

  const result = await sendEvolutionText(baseInput(fetchImpl));

  assert.deepEqual(Object.keys(result).sort(), [
    "httpStatus",
    "providerMessageId",
    "providerStatus",
    "responseReceived"
  ]);
});

test("no existe fallback a payload legacy", async () => {
  const { calls, fetchImpl } = createFetch(jsonResponse({ message: "bad payload" }, 400));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "PERMANENT_PROVIDER_ERROR"
  );

  assert.equal(calls.length, 1);
  assert.equal("textMessage" in readPayload(calls[0]!), false);
});

test("una falla no dispara una segunda peticion", async () => {
  const { calls, fetchImpl } = createFetch(jsonResponse({ message: "bad payload" }, 400));

  await assertRejectsWithCategory(
    () => sendEvolutionText(baseInput(fetchImpl)),
    "PERMANENT_PROVIDER_ERROR"
  );

  assert.equal(calls.length, 1);
});
