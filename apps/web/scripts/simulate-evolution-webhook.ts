const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const webhookSecret = process.env.WEBHOOK_SECRET ?? "dev-webhook-secret";
const endpoint = `${appUrl.replace(/\/$/, "")}/api/webhooks/evolution`;

type SimulationCase = {
  name: string;
  payload: {
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
};

const now = Math.floor(Date.now() / 1000);
const runId = Date.now();
const duplicateMessageId = `sim-payment-${runId}`;

const simulations: SimulationCase[] = [
  {
    name: "Prospecto pidiendo precio",
    payload: {
      event: "messages.upsert",
      instance: "demo-evolution-instance",
      data: {
        key: {
          id: `sim-price-${runId}`,
          remoteJid: "525512349999@s.whatsapp.net",
          fromMe: false
        },
        pushName: "Paula Simulada",
        messageType: "conversation",
        messageTimestamp: now,
        message: {
          conversation: "Hola, quiero saber el precio del servicio."
        }
      }
    }
  },
  {
    name: "Cliente vendido pidiendo soporte",
    payload: {
      event: "messages.upsert",
      instance: "demo-evolution-instance",
      data: {
        key: {
          id: `sim-support-${runId}`,
          remoteJid: "525512340001@s.whatsapp.net",
          fromMe: false
        },
        pushName: "Ana Lopez",
        messageType: "conversation",
        messageTimestamp: now + 1,
        message: {
          conversation: "Ya soy cliente y necesito soporte con mi configuracion."
        }
      }
    }
  },
  {
    name: "Cliente pendiente de pago escribiendo",
    payload: {
      event: "messages.upsert",
      instance: "demo-evolution-instance",
      data: {
        key: {
          id: duplicateMessageId,
          remoteJid: "525512340002@s.whatsapp.net",
          fromMe: false
        },
        pushName: "Bruno Martinez",
        messageType: "conversation",
        messageTimestamp: now + 2,
        message: {
          conversation: "Puedo pagar mañana? Me pasan la referencia de nuevo."
        }
      }
    }
  },
  {
    name: "Cliente molesto reclamando configuracion",
    payload: {
      event: "messages.upsert",
      instance: "demo-evolution-instance",
      data: {
        key: {
          id: `sim-angry-config-${runId}`,
          remoteJid: "525512340004@s.whatsapp.net",
          fromMe: false
        },
        pushName: "Diego Ramirez",
        messageType: "conversation",
        messageTimestamp: now + 3,
        message: {
          conversation:
            "Estoy molesto, pague y todavia no me configuraron nada. Necesito solucion urgente."
        }
      }
    }
  },
  {
    name: "Mensaje duplicado con mismo providerMessageId",
    payload: {
      event: "messages.upsert",
      instance: "demo-evolution-instance",
      data: {
        key: {
          id: duplicateMessageId,
          remoteJid: "525512340002@s.whatsapp.net",
          fromMe: false
        },
        pushName: "Bruno Martinez",
        messageType: "conversation",
        messageTimestamp: now + 4,
        message: {
          conversation: "Este payload simula un duplicado y no debe duplicarse."
        }
      }
    }
  }
];

async function postSimulation(simulation: SimulationCase) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": webhookSecret
    },
    body: JSON.stringify(simulation.payload)
  });
  const body = (await response.json()) as unknown;

  console.log(
    JSON.stringify(
      {
        case: simulation.name,
        status: response.status,
        body
      },
      null,
      2
    )
  );

  if (!response.ok) {
    throw new Error(`Simulation failed: ${simulation.name}`);
  }
}

for (const simulation of simulations) {
  await postSimulation(simulation);
}
