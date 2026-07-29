# Evolution API outbound contract

Verification date: 2026-07-10

This document records the outbound text-message contract selected for JAHF Comm.
It is intentionally limited to the deployed Evolution API version confirmed by a
read-only root endpoint check. It does not contain API keys, webhook secrets,
real instance names, real phone numbers, or personal provider responses.

## Confirmed Version

- Deployed version: Evolution API `2.3.7`
- Official repository: `https://github.com/EvolutionAPI/evolution-api`
- Official release label: `v2.3.7`
- Official git tag inspected: `2.3.7`
- Release commit inspected: `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`
- Root endpoint response shape confirmed by operator: status `200`, welcome
  message, version `2.3.7`, client name `evolution_exchange`.

The root endpoint was used only to identify the deployed version. No API key,
webhook secret, real phone number, or real instance name is documented here.

## Official Source Checked

The following files were inspected at commit `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`:

- `src/api/routes/index.router.ts`
- `src/api/routes/sendMessage.router.ts`
- `src/api/controllers/sendMessage.controller.ts`
- `src/api/dto/sendMessage.dto.ts`
- `src/validate/message.schema.ts`
- `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`

The public Evolution Foundation v2 documentation page for "Send Text Message"
was also reviewed as corroboration for the route and headers. That public page
currently shows a nested `textMessage` example, while the exact `2.3.7` tag
confirmed for this deployment validates `text` at the payload root. JAHF Comm
therefore follows the exact deployed tag source code, not the broader public
example.

Relevant findings:

- `index.router.ts` mounts the message router at `/message`.
- `sendMessage.router.ts` registers `POST /sendText/:instanceName` and returns
  `HttpStatus.CREATED` (`201`) on success.
- `abstract.router.ts` builds route paths as `/<path>/:instanceName`.
- `sendMessage.controller.ts` delegates `sendText` to the active instance
  `textMessage(data)`.
- `sendMessage.dto.ts` defines `SendTextDto` as `number` plus `text`, inheriting
  optional message metadata.
- `message.schema.ts` requires `number` and `text` for text messages.
- The Baileys channel returns the sent WhatsApp message object produced by the
  underlying send flow, including `key.id` when accepted by the provider.

## HTTP Contract

Method:

```text
POST
```

Path:

```text
/message/sendText/{instance}
```

URL construction:

```text
{EVOLUTION_API_URL}/message/sendText/{encodeURIComponent(instanceName)}
```

If `EVOLUTION_API_URL` already includes a path prefix such as `/api`, that prefix
must be preserved:

```text
https://host/api/message/sendText/{instance}
```

Required headers:

```text
Content-Type: application/json
apikey: <api-key>
```

Minimum payload for Evolution API `2.3.7`:

```json
{
  "number": "5215551234567",
  "text": "Mensaje interno"
}
```

Supported optional fields from the verified schema/DTO:

- `delay`
- `linkPreview`
- `quoted`
- `mentioned`
- `mentionsEveryOne` in DTO and runtime options
- `everyOne` in the JSON schema

JAHF Comm currently exposes only `delay` and `linkPreview` in the low-level
client because that is all the next alert-delivery stage needs.

## Response Contract

Expected success status:

```text
201 Created
```

Relevant successful response shape:

```json
{
  "key": {
    "remoteJid": "...",
    "fromMe": true,
    "id": "..."
  },
  "message": {
    "...": "..."
  },
  "messageTimestamp": "...",
  "status": "PENDING"
}
```

Provider message id:

```text
response.key.id
```

Provider status:

```text
response.status
```

Important limitation: HTTP `201` means Evolution API accepted or processed the
send request according to the available contract. It does not guarantee that the
recipient read the message.

## Selected Payload Mode

JAHF Comm uses exactly one payload contract for Evolution API `2.3.7`:

```json
{
  "number": "...",
  "text": "..."
}
```

The legacy/nested payload is not used:

```json
{
  "number": "...",
  "textMessage": {
    "text": "..."
  }
}
```

There is no automatic fallback between payload modes. A failed request must not
trigger a second request with a different body because the first request may have
been accepted even if the response was lost.

## Error Classification

The outbound client maps provider and transport failures into
`EvolutionOutboundError`:

- `VALIDATION`: invalid local input such as missing URL, empty text, invalid
  protocol, or oversized text.
- `AUTHENTICATION`: HTTP `401` or `403`.
- `INSTANCE_NOT_FOUND`: HTTP `404`.
- `DESTINATION_INVALID`: invalid local destination number, or HTTP `400` whose
  sanitized response indicates destination/number problems.
- `RATE_LIMITED`: HTTP `429`, retryable.
- `TRANSIENT_PROVIDER_ERROR`: HTTP `500`, `502`, `503`, or `504`, retryable.
- `PERMANENT_PROVIDER_ERROR`: other provider rejections, not retryable by
  default.
- `TIMEOUT_UNKNOWN`: client timeout after the request started. Delivery is
  unknown and the client does not automatically retry.
- `INVALID_PROVIDER_RESPONSE`: invalid JSON or success response without
  `key.id`.
- `NETWORK_ERROR`: transport failure before a provider response is available.

Errors expose only safe fields:

- `category`
- `retryable`
- `deliveryUnknown`
- `httpStatus`
- `safeMessage`

The client does not expose raw provider responses, API keys, full phone numbers,
or the full message text in logs.

## Test Safety

Automated tests use mocked `fetch`/local response objects only. They do not call
`EVOLUTION_API_URL`, do not use `EVOLUTION_API_KEY`, do not POST to Evolution API,
and do not send WhatsApp messages.
