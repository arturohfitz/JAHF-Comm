import { prisma } from "@jahf-comm/db";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const webhookSecret = process.env.WEBHOOK_SECRET ?? "dev-webhook-secret";
const endpoint = `${appUrl.replace(/\/$/, "")}/api/webhooks/evolution`;
const demoInstanceName = "demo-evolution-instance";

console.log(
  "Simulando webhooks Evolution. Ejecuta pnpm worker:dev en paralelo para procesar IA."
);

type SimulationPayload = {
  event: string;
  instance: string;
  data: {
    key: {
      id: string;
      remoteJid: string;
      fromMe: boolean;
    };
    pushName: string;
    messageType: string;
    messageTimestamp: number;
    message: {
      conversation?: string;
      extendedTextMessage?: {
        text: string;
      };
    };
  };
};

type SimulationCase = {
  name: string;
  expectedStatus: number;
  secret: string;
  payload: SimulationPayload;
};

function makePayload(input: {
  id: string;
  instance: string;
  remoteJid: string;
  pushName: string;
  text: string;
  timestamp: number;
}): SimulationPayload {
  return {
    event: "messages.upsert",
    instance: input.instance,
    data: {
      key: {
        id: input.id,
        remoteJid: input.remoteJid,
        fromMe: false
      },
      pushName: input.pushName,
      messageType: "conversation",
      messageTimestamp: input.timestamp,
      message: {
        conversation: input.text
      }
    }
  };
}

const now = Math.floor(Date.now() / 1000);
const runId = Date.now();
const duplicateMessageId = `sim-valid-duplicate-${runId}`;
const badSecretMessageId = `sim-bad-secret-${runId}`;
const unknownInstanceMessageId = `sim-unknown-instance-${runId}`;
const inboxMessageId = `sim-inbox-${runId}`;

const simulations: SimulationCase[] = [
  {
    name: "Mensaje valido con instanceName demo",
    expectedStatus: 200,
    secret: webhookSecret,
    payload: makePayload({
      id: duplicateMessageId,
      instance: demoInstanceName,
      remoteJid: "525512349901@s.whatsapp.net",
      pushName: "Valeria Evolution",
      text: "Hola, quiero cotizar el servicio.",
      timestamp: now
    })
  },
  {
    name: "Mensaje duplicado",
    expectedStatus: 200,
    secret: webhookSecret,
    payload: makePayload({
      id: duplicateMessageId,
      instance: demoInstanceName,
      remoteJid: "525512349901@s.whatsapp.net",
      pushName: "Valeria Evolution",
      text: "Payload duplicado que no debe crear otro mensaje.",
      timestamp: now + 1
    })
  },
  {
    name: "Secreto incorrecto",
    expectedStatus: 401,
    secret: "incorrect-webhook-secret",
    payload: makePayload({
      id: badSecretMessageId,
      instance: demoInstanceName,
      remoteJid: "525512349902@s.whatsapp.net",
      pushName: "Secreto Incorrecto",
      text: "Este mensaje debe quedar como no autorizado.",
      timestamp: now + 2
    })
  },
  {
    name: "Instancia desconocida",
    expectedStatus: 404,
    secret: webhookSecret,
    payload: makePayload({
      id: unknownInstanceMessageId,
      instance: `unknown-instance-${runId}`,
      remoteJid: "525512349903@s.whatsapp.net",
      pushName: "Instancia Desconocida",
      text: "Este mensaje debe fallar por instancia desconocida.",
      timestamp: now + 3
    })
  },
  {
    name: "Mensaje valido que entra al inbox",
    expectedStatus: 200,
    secret: webhookSecret,
    payload: makePayload({
      id: inboxMessageId,
      instance: demoInstanceName,
      remoteJid: "525512349904@s.whatsapp.net",
      pushName: "Inbox Evolution",
      text: "Este mensaje debe aparecer en el inbox demo.",
      timestamp: now + 4
    })
  }
];

async function postSimulation(simulation: SimulationCase) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": simulation.secret
    },
    body: JSON.stringify(simulation.payload)
  });
  const body = (await response.json()) as unknown;
  const ok = response.status === simulation.expectedStatus;

  console.log(
    JSON.stringify(
      {
        case: simulation.name,
        expectedStatus: simulation.expectedStatus,
        status: response.status,
        ok,
        body,
        aiQueue:
          body && typeof body === "object" && "aiQueue" in body
            ? (body as { aiQueue: unknown }).aiQueue
            : null
      },
      null,
      2
    )
  );

  if (!ok) {
    throw new Error(
      `Simulation failed: ${simulation.name}. Expected ${simulation.expectedStatus}, got ${response.status}.`
    );
  }
}

try {
  for (const simulation of simulations) {
    await postSimulation(simulation);
  }

  const providerMessageIds = [
    duplicateMessageId,
    badSecretMessageId,
    unknownInstanceMessageId,
    inboxMessageId
  ];
  const logs = await prisma.webhookLog.findMany({
    where: {
      providerMessageId: {
        in: providerMessageIds
      }
    },
    orderBy: { createdAt: "asc" },
    select: {
      providerMessageId: true,
      status: true,
      httpStatus: true,
      providerInstanceId: true,
      errorMessage: true
    }
  });

  console.log(
    JSON.stringify(
      {
        webhookLogs: logs,
        expectedStates: ["PROCESSED", "DUPLICATE", "UNAUTHORIZED", "FAILED"],
        note: "Los mensajes validos deben aparecer en /inbox y sus jobs de IA se procesan con pnpm worker:dev."
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
