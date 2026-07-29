import { Socket, connect as connectTcp } from "node:net";
import { TLSSocket, connect as connectTls } from "node:tls";

type SmtpSocket = Socket | TLSSocket;

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  startTls: boolean;
  user?: string;
  password?: string;
  from: string;
  timeoutMs: number;
};

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function getSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM?.trim();
  const port = Number(env.SMTP_PORT || "587");

  if (!host) {
    throw new Error("SMTP_HOST is required to send email.");
  }

  if (!from) {
    throw new Error("SMTP_FROM is required to send email.");
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }

  return {
    host,
    port,
    secure: readBoolean(env.SMTP_SECURE, port === 465),
    startTls: readBoolean(env.SMTP_STARTTLS, port !== 25 && port !== 465),
    user: env.SMTP_USER?.trim() || undefined,
    password: env.SMTP_PASSWORD || undefined,
    from,
    timeoutMs: Number(env.SMTP_TIMEOUT_MS || "15000")
  };
}

function encodeHeader(value: string) {
  if (/^[\x20-\x7E]+$/.test(value)) {
    return value;
  }

  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function normalizeLines(value: string) {
  return value.replace(/\r?\n/g, "\r\n");
}

function dotStuff(value: string) {
  return normalizeLines(value)
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function buildRawMessage(input: { from: string; message: MailMessage }) {
  return [
    `From: ${input.from}`,
    `To: ${input.message.to}`,
    `Subject: ${encodeHeader(input.message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuff(input.message.text)
  ].join("\r\n");
}

async function connect(config: SmtpConfig): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const socket = config.secure
      ? connectTls({
          host: config.host,
          port: config.port,
          servername: config.host
        })
      : connectTcp({
          host: config.host,
          port: config.port
        });

    socket.setTimeout(config.timeoutMs);
    if (config.secure) {
      socket.once("secureConnect", () => resolve(socket));
    } else {
      socket.once("connect", () => resolve(socket));
    }
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("SMTP connection timed out."));
    });
    socket.once("error", () => {
      reject(new Error("SMTP connection failed."));
    });
  });
}

function createReader(socket: SmtpSocket) {
  let buffer = "";
  const waiters: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
  }> = [];

  function consume() {
    const index = buffer.indexOf("\r\n");

    if (index < 0 || waiters.length === 0) {
      return;
    }

    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    waiters.shift()?.resolve(line);
    consume();
  }

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    consume();
  });
  socket.on("error", () => {
    waiters.splice(0).forEach((waiter) => {
      waiter.reject(new Error("SMTP connection failed."));
    });
  });

  return async function readResponse() {
    const lines: string[] = [];

    for (;;) {
      const line = await new Promise<string>((resolve, reject) => {
        waiters.push({ resolve, reject });
        consume();
      });

      lines.push(line);

      if (/^\d{3} /.test(line)) {
        return {
          code: Number(line.slice(0, 3)),
          lines
        };
      }
    }
  };
}

async function writeCommand(
  socket: SmtpSocket,
  readResponse: () => Promise<{ code: number; lines: string[] }>,
  command: string,
  expectedCodes: number[]
) {
  socket.write(`${command}\r\n`);
  const response = await readResponse();

  if (!expectedCodes.includes(response.code)) {
    throw new Error("SMTP server rejected the email request.");
  }

  return response;
}

async function upgradeToTls(socket: SmtpSocket, host: string) {
  return new Promise<TLSSocket>((resolve, reject) => {
    const tlsSocket = connectTls({
      socket,
      servername: host
    });

    tlsSocket.once("secureConnect", () => resolve(tlsSocket));
    tlsSocket.once("error", () => {
      reject(new Error("SMTP STARTTLS failed."));
    });
  });
}

export async function sendMail(message: MailMessage) {
  const config = getSmtpConfig();
  let socket = await connect(config);
  let readResponse = createReader(socket);

  try {
    const greeting = await readResponse();

    if (greeting.code !== 220) {
      throw new Error("SMTP server is not ready.");
    }

    await writeCommand(socket, readResponse, "EHLO jahf-comm", [250]);

    if (!config.secure && config.startTls) {
      await writeCommand(socket, readResponse, "STARTTLS", [220]);
      socket = await upgradeToTls(socket, config.host);
      readResponse = createReader(socket);
      await writeCommand(socket, readResponse, "EHLO jahf-comm", [250]);
    }

    if (config.user && config.password) {
      await writeCommand(socket, readResponse, "AUTH LOGIN", [334]);
      await writeCommand(
        socket,
        readResponse,
        Buffer.from(config.user, "utf8").toString("base64"),
        [334]
      );
      await writeCommand(
        socket,
        readResponse,
        Buffer.from(config.password, "utf8").toString("base64"),
        [235]
      );
    }

    await writeCommand(socket, readResponse, `MAIL FROM:<${config.from}>`, [250]);
    await writeCommand(socket, readResponse, `RCPT TO:<${message.to}>`, [250, 251]);
    await writeCommand(socket, readResponse, "DATA", [354]);
    socket.write(`${buildRawMessage({ from: config.from, message })}\r\n.\r\n`);

    const dataResponse = await readResponse();

    if (dataResponse.code !== 250) {
      throw new Error("SMTP server rejected the email body.");
    }

    await writeCommand(socket, readResponse, "QUIT", [221]);
  } finally {
    socket.end();
  }
}
