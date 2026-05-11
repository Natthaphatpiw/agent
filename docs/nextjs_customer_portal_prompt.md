# Prompt: Build NextJS Customer Portal for AgentCore Customer Service Agent

คุณคือ senior full-stack engineer ให้สร้างโฟลเดอร์ใหม่ใน repo นี้ชื่อ `web-customer-portal` เป็น NextJS full-stack application ที่เชื่อมต่อกับ Amazon Bedrock AgentCore Runtime agent เดิมในโปรเจกต์นี้

## Context ของ agent ที่ต้องเชื่อมต่อ

- AgentCore project อยู่ที่ `/Users/natthaphat/Downloads/agent_data/agentP`
- Agent runtime name: `MyAgent`
- AWS region: `ap-southeast-2`
- Runtime ARN: `arn:aws:bedrock-agentcore:ap-southeast-2:885418708466:runtime/agentP_MyAgent-dZmbmm3KDS`
- Agent endpoint จาก `agentcore status`:
  `https://bedrock-agentcore.ap-southeast-2.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aap-southeast-2%3A885418708466%3Aruntime%2FagentP_MyAgent-dZmbmm3KDS/invocations`
- Text model in agent: `deepseek.v3.2`
- Agent รองรับ payload:

```json
{
  "input_type": "text",
  "response_format": "jsonl",
  "channel": "web",
  "session_id": "session-id-from-app",
  "user_id": "stable-actor-id",
  "prompt": "ข้อความของ user"
}
```

- Agent จะ stream JSONL events เมื่อส่ง `response_format: "jsonl"`:

```json
{"type":"text_delta","text":"ข้อความตอบกลับ"}
{"type":"session_state","session_id":"...","actor_id":"...","session_ended":false,"ttl_seconds":3600}
```

- Voice payload ใช้ base64 PCM:

```json
{
  "input_type": "voice",
  "channel": "web",
  "session_id": "session-id-from-app",
  "user_id": "stable-actor-id",
  "audio_format": "pcm",
  "sample_rate": 16000,
  "channels": 1,
  "audio_base64": "BASE64_PCM_AUDIO"
}
```

## App ที่ต้องสร้าง

สร้าง NextJS App Router + TypeScript + Tailwind CSS แบบ full-stack ให้ UI คลีนและดูเหมือนเว็บประกันภัย/สมาชิกบริการลูกค้า ไม่ใช่ dashboard หนัก ๆ หน้าแรกควรมี:

- Header เรียบง่าย มี brand, nav, CTA สมัครสมาชิก
- Hero insurance-style มี headline ภาษาไทยเกี่ยวกับการดูแลสมาชิก/สิทธิประโยชน์/บริการหลังการขาย
- Section benefits/coverage cards แบบเรียบ สุภาพ สีขาว น้ำเงิน เขียว หรือ teal ห้ามใช้ gradient หนัก
- Section สมัครสมาชิกพร้อม form
- Floating chat button มุมขวาล่าง เมื่อกดเปิด popup chat
- Chat popup รองรับ text และ voice input
- UI responsive ทั้ง mobile/desktop

## สมัครสมาชิก

Form สมัครสมาชิกต้องมี:

- full_name
- phone_number
- email optional
- address optional
- security_question
- security_answer
- notes optional

ห้าม insert `security_answer_hash` จาก client โดยตรง ให้สร้าง API route ฝั่ง server:

- `POST /api/customers/register`
- ใช้ Supabase service role key เฉพาะ server
- เรียก Supabase RPC `register_customer` ถ้ามี:

```ts
supabase.rpc("register_customer", {
  full_name_input,
  phone_number_input,
  email_input,
  address_input,
  security_question_input,
  security_answer_input,
  notes_input
})
```

ถ้า RPC ยังไม่มี ให้ให้ error ที่อ่านง่ายและบอกให้รัน SQL schema ก่อน ห้าม fallback ไปเก็บ security answer เป็น plain text

## Agent chat API

สร้าง route:

- `POST /api/agent/chat`

หน้าที่:

- รับ `{ message, sessionId?, channel, userId? }`
- จัดการ session จาก server
- เรียก AgentCore Runtime จาก server เท่านั้นด้วย AWS SDK:

```ts
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  StopRuntimeSessionCommand
} from "@aws-sdk/client-bedrock-agentcore";
```

- ใช้ `InvokeAgentRuntimeCommand` โดยส่ง `agentRuntimeArn`, `runtimeSessionId`, `payload`, `contentType: "application/json"`, `qualifier: "DEFAULT"`
- ส่ง payload ไปหา agent ด้วย `response_format: "jsonl"`
- Stream response กลับ browser เป็น SSE หรือ JSONL
- Parse event `session_state`
- ถ้า `session_ended=true` ให้ mark session เป็น ended และเรียก `StopRuntimeSessionCommand` เพื่อหยุด AgentCore runtime session ถ้าทำได้
- ถ้าไม่มี session_ended ให้ extend expiry ไปอีก 60 นาที

ห้ามเรียก AgentCore Runtime โดยตรงจาก browser เพราะต้องใช้ AWS credentials

## Voice input

รองรับ voice ใน chat popup:

- Browser: มีปุ่มไมค์
- ทางเลือกที่ง่ายและ UX ดี: ใช้ Web Speech API เพื่อแปลงเสียงเป็น text ก่อน แล้วส่งเข้า `/api/agent/chat`
- ทางเลือกเต็มรูปแบบ: record audio เป็น Blob แล้วส่ง `/api/agent/voice`

ถ้าทำ `/api/agent/voice`:

- รับ audio Blob จาก browser
- แปลงเป็น PCM 16k mono ฝั่ง server ก่อนส่ง agent
- ส่ง payload `input_type: "voice"` พร้อม `audio_base64`
- Stream transcript/audio events กลับ UI
- ถ้า deploy environment ไม่รองรับ ffmpeg ให้ fallback เป็น Web Speech API text mode

## LINE OA Messaging API

สร้าง webhook route:

- `POST /api/line/webhook`

ข้อกำหนด:

- Verify `x-line-signature` ด้วย `LINE_CHANNEL_SECRET`
- รองรับ text message
- actor id สำหรับ LINE ต้องเป็น `line:${event.source.userId}`
- session ต้องมาจาก session store โดยใช้ key `channel=line` + `lineUserId`
- ถ้าไม่มี active session หรือ session หมดอายุเกิน 60 นาที ให้สร้าง session ใหม่
- ส่งข้อความเข้า agent ด้วย payload:

```json
{
  "input_type": "text",
  "response_format": "jsonl",
  "channel": "line",
  "session_id": "server-managed-session-id",
  "user_id": "line:${lineUserId}",
  "line_reply_token": "replyToken",
  "prompt": "ข้อความจาก LINE"
}
```

- รวม `text_delta` เป็นข้อความเดียว แล้ว reply ผ่าน LINE Messaging API
- ถ้า agent ส่ง `session_ended=true` ให้ปิด session
- ถ้าเกิน 60 นาทีโดยไม่มี activity ให้ปิด session และสร้างใหม่ในข้อความถัดไป
- สำหรับ LINE voice message ให้ดาวน์โหลด content จาก LINE API แล้วถ้า server transcode เป็น PCM ได้ ให้ส่ง voice payload เข้า agent; ถ้าทำไม่ได้ให้ตอบกลับว่า voice บน LINE ยังไม่พร้อมและให้พิมพ์ข้อความแทน

## Session storage

สร้าง Supabase table/migration สำหรับ session:

```sql
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('web', 'line')),
  actor_id text not null,
  status text not null default 'active' check (status in ('active', 'ended', 'expired')),
  agent_session_id text not null unique,
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 minutes',
  created_at timestamptz not null default now(),
  ended_at timestamptz null
);

create index if not exists chat_sessions_actor_active_idx
on public.chat_sessions(channel, actor_id, status, expires_at);
```

Session rule:

- `actor_id` stable ต่อ user/channel
- `agent_session_id` ส่งเข้า AgentCore ทุกครั้ง
- ถ้า `status='active'` และ `expires_at > now()` ให้ reuse
- ถ้าหมดอายุให้ mark `expired` และสร้างใหม่
- ถ้า agent ส่ง `session_ended=true` ให้ mark `ended`
- default TTL = 60 minutes

## Environment variables

สร้าง `.env.example`:

```bash
AWS_REGION=ap-southeast-2
AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:ap-southeast-2:885418708466:runtime/agentP_MyAgent-dZmbmm3KDS
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SESSION_TOKEN=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=

SESSION_TTL_SECONDS=3600
```

## Implementation quality

- ใช้ server routes สำหรับ secrets ทั้งหมด
- Client ห้ามเห็น AWS key, Supabase service role key, LINE access token
- แยกไฟล์:
  - `lib/agentcore.ts`
  - `lib/sessions.ts`
  - `lib/supabaseAdmin.ts`
  - `lib/line.ts`
  - `app/api/agent/chat/route.ts`
  - `app/api/agent/voice/route.ts` ถ้าทำ voice binary
  - `app/api/customers/register/route.ts`
  - `app/api/line/webhook/route.ts`
- UI components แยก:
  - `components/chat-widget.tsx`
  - `components/member-signup-form.tsx`
  - `components/insurance-hero.tsx`
- ตรวจ validation, error states, loading states, disabled states
- หลังสร้างเสร็จให้รัน lint/typecheck/build และสรุปวิธี run

## Acceptance test

- เปิดหน้าเว็บ เห็น insurance-style homepage
- สมัครสมาชิกแล้วข้อมูลถูกเพิ่มผ่าน RPC `register_customer`
- กด chat มุมขวาล่างแล้วถาม `มีข้อมูลของอนงค์ไหม`
- Chat แสดงคำตอบจาก agent และถามยืนยันตัวตน
- LINE webhook รับข้อความและ reply ได้
- Session เดิมถูก reuse ภายใน 60 นาที และจบเมื่อ agent ส่ง `session_ended=true`
