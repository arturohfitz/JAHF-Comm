# Evolution API

JAHF Comm esta preparado para recibir mensajes entrantes de Evolution API en el webhook de Next.js.

## Variables de entorno

```bash
WEBHOOK_SECRET="dev-webhook-secret"
APP_URL="http://localhost:3000"
EVOLUTION_ALLOW_DEMO_FALLBACK="true"
EVOLUTION_API_URL=""
EVOLUTION_API_KEY=""
```

`WEBHOOK_SECRET` debe configurarse como secreto real en produccion. `EVOLUTION_API_KEY` queda reservado para llamadas futuras hacia Evolution API y no debe guardarse en Git.

## URL del webhook

Local:

```text
http://localhost:3000/api/webhooks/evolution
```

Produccion:

```text
https://comms.jahfconnect.com/api/webhooks/evolution
```

`localhost` no sirve para recibir webhooks externos desde Evolution API. Para pruebas externas debe usarse una URL publica; en produccion sera `comms.jahfconnect.com`.

## Header requerido

Cada request debe incluir:

```text
x-webhook-secret: <WEBHOOK_SECRET>
```

El sistema no guarda headers ni secretos en `WebhookLog`.

Este webhook no usa la sesion web de `/login`. Evolution API se autentica solamente con `x-webhook-secret`, para que la recepcion de mensajes siga funcionando aunque no haya un usuario humano conectado.

## Resolucion de instancia

El payload de Evolution debe traer `instance`, `instanceName` o `instanceId`. Ese valor debe coincidir con `WhatsAppAccount.instanceName`, `WhatsAppAccount.providerInstanceId` o el campo legacy `providerAccountId`.

La pantalla `/settings/whatsapp` permite revisar y actualizar la cuenta demo, incluyendo `instanceName`, `providerInstanceId`, telefono, nombre visible y estatus. Cada cambio crea `AuditLog`.

En desarrollo, `EVOLUTION_ALLOW_DEMO_FALLBACK=true` permite usar la cuenta demo solo cuando el payload no trae instancia. Si el payload trae una instancia explicita desconocida, el webhook marca el evento como `FAILED` para evitar mezclar empresas.

## Logs de webhook

Cada request queda registrado en `WebhookLog` con uno de estos estados:

- `RECEIVED`: payload recibido y registrado al inicio.
- `PROCESSED`: mensaje nuevo guardado correctamente.
- `DUPLICATE`: el `providerMessageId` ya existia para el tenant.
- `FAILED`: JSON invalido, payload no normalizable, instancia desconocida o error interno.
- `UNAUTHORIZED`: `x-webhook-secret` invalido.

La pantalla `/settings/webhooks` muestra los ultimos logs, estado HTTP, instancia, `providerMessageId`, error y `rawPayload` formateado sin headers secretos.

## Prueba local

Con PostgreSQL, Redis, web y worker activos:

```bash
docker compose up -d
pnpm dev
pnpm worker:dev
pnpm webhook:simulate
```

El simulador prueba:

- Mensaje valido con `instanceName` demo.
- Mensaje duplicado.
- Secreto incorrecto.
- Instancia desconocida.
- Mensaje valido que entra al inbox.

Los mensajes nuevos se guardan en `Contact`, `Conversation` y `Message`, despues se encola `CLASSIFY_CONVERSATION_MESSAGE` en BullMQ para que `apps/worker` genere la clasificacion IA.
