# Customer DB Gateway Setup

This project uses AgentCore Gateway with a Lambda target for all Supabase customer database operations.

## 1. Create Supabase Tables

Open Supabase SQL Editor and run:

```sql
-- agentcore/supabase/customer_service_schema.sql
```

The SQL creates `public.customers`, helper RPC functions, and mock customers.

## 2. Create Lambda

Create a Python Lambda in AWS Console and paste the code from:

```text
agentcore/gateway/customer_db_lambda.py
```

Set the Lambda handler to:

```text
customer_db_lambda.lambda_handler
```

Environment variables required by the Lambda:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project URL, for example `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key. Keep this secret. |
| `VERIFICATION_TOKEN_SECRET` | Any long random string for signing verification tokens |

Recommended Lambda settings:

- Runtime: Python 3.12 or newer
- Timeout: 15-30 seconds
- Memory: 256 MB or higher

## 3. Update AgentCore Config

Edit `agentcore/agentcore.json`:

- Replace `REPLACE_CustomerDbTools` in `agentCoreGateways[0].targets[0].lambdaFunctionArn.lambdaArn` with your Lambda ARN.
- After `agentcore deploy`, run `agentcore status`, copy the Gateway MCP URL, and replace `CUSTOMER_DB_GATEWAY_URL`.
- If you change Gateway inbound auth from `NONE` to `CUSTOM_JWT`, set `CUSTOMER_DB_GATEWAY_BEARER_TOKEN` for local/dev invocations.

Voice settings are also in `agentcore/agentcore.json`:

- `VOICE_MODEL_ID`: defaults to `amazon.nova-sonic-v1:0`
- `VOICE_AWS_REGION`: defaults to `us-east-1`
- `VOICE_OUTPUT_VOICE`: `ruth` or `matthew`

## 4. Expected Runtime Payloads

Text:

```json
{
  "input_type": "text",
  "session_id": "session-001",
  "user_id": "user-001",
  "prompt": "ขอข้อมูลของคุณอนงค์หน่อย"
}
```

Voice:

```json
{
  "input_type": "voice",
  "session_id": "session-001",
  "user_id": "user-001",
  "audio_format": "pcm",
  "sample_rate": 16000,
  "channels": 1,
  "audio_chunks": ["BASE64_PCM_CHUNK_1", "BASE64_PCM_CHUNK_2"]
}
```

Voice responses are JSON lines containing transcript and `assistant_audio` events. The client should play `assistant_audio.audio` as base64 audio using the returned format/sample rate/channel metadata.
