# AgentCare Customer Portal

Next.js App Router full-stack portal for the AgentCore runtime `MyAgent`.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Fill AWS, Supabase service role, and LINE Messaging API values.
3. Run the Supabase SQL in `supabase/migrations/`.
4. Start the app:

```bash
npm run dev
```

## Routes

- `POST /api/customers/register` calls Supabase RPC `register_customer`.
- `POST /api/agent/chat` invokes AgentCore Runtime from the server and streams SSE to the browser.
- `POST /api/line/webhook` verifies LINE signatures, sends text to AgentCore, and replies through LINE Messaging API.

Voice in the web chat uses the browser Web Speech API and sends transcribed Thai text to `/api/agent/chat`.

