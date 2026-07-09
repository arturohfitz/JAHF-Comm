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

const simulations: SimulationCase[] = [
  {
    name: "Cliente nuevo preguntando precio",
    payload: {
      event: "messages.upsert",
      instance: "demo-evolution-instance",
      data: {
        key: {
          id: "sim-price-001",
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
    name: "Cliente existente pidiendo soporte",
    payload: {
      event: "messages.upsert",
      instance: "demo-evolution-instance",
      data: {
        key: {
          id: "sim-support-001",
          remoteJid: "525512340003@s.whatsapp.net",
          fromMe: false
        },
        pushName: "Carla Torres",
        messageType: "conversation",
        messageTimestamp: now + 1,
        message: {
          conversation: "Necesito ayuda con mi configuracion, por favor."
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
          id: "sim-payment-001",
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
    name: "Mensaje duplicado con mismo providerMessageId",
    payload: {
      event: "messages.upsert",
      instance: "demo-evolution-instance",
      data: {
        key: {
          id: "sim-payment-001",
          remoteJid: "525512340002@s.whatsapp.net",
          fromMe: false
        },
        pushName: "Bruno Martinez",
        messageType: "conversation",
        messageTimestamp: now + 3,
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
