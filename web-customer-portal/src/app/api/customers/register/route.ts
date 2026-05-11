import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type RegisterCustomerBody = {
  full_name?: unknown;
  phone_number?: unknown;
  email?: unknown;
  address?: unknown;
  security_question?: unknown;
  security_answer?: unknown;
  notes?: unknown;
};

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalText(value: unknown) {
  const text = readText(value);

  return text || null;
}

function missingRpcError(message: string, code?: string) {
  return (
    code === "PGRST202" ||
    code === "PGRST204" ||
    /register_customer|schema cache|function/i.test(message)
  );
}

function friendlySupabaseError(error: { code?: string; message: string }) {
  if (missingRpcError(error.message, error.code)) {
    return {
      status: 501,
      message:
        "ยังไม่พบ Supabase RPC register_customer กรุณารัน SQL schema/RPC ก่อนใช้งานฟอร์มสมัครสมาชิก ระบบจะไม่เก็บ security answer เป็น plain text",
    };
  }

  if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
    return {
      status: 409,
      message: "เบอร์โทรหรืออีเมลนี้มีอยู่ในระบบแล้ว",
    };
  }

  return {
    status: 500,
    message: error.message,
  };
}

export async function POST(request: Request) {
  let body: RegisterCustomerBody;

  try {
    body = (await request.json()) as RegisterCustomerBody;
  } catch {
    return Response.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  const fullName = readText(body.full_name);
  const phoneNumber = readText(body.phone_number);
  const email = readOptionalText(body.email);
  const address = readOptionalText(body.address);
  const securityQuestion = readText(body.security_question);
  const securityAnswer = readText(body.security_answer);
  const notes = readOptionalText(body.notes);

  if (!fullName || !phoneNumber || !securityQuestion || !securityAnswer) {
    return Response.json(
      {
        ok: false,
        error: "กรุณากรอกชื่อ เบอร์โทร คำถามยืนยันตัวตน และคำตอบยืนยันตัวตน",
      },
      { status: 400 },
    );
  }

  const { data, error } = await getSupabaseAdmin().rpc("register_customer", {
    full_name_input: fullName,
    phone_number_input: phoneNumber,
    email_input: email,
    address_input: address,
    security_question_input: securityQuestion,
    security_answer_input: securityAnswer,
    notes_input: notes,
  });

  if (error) {
    const friendlyError = friendlySupabaseError(error);

    return Response.json(
      {
        ok: false,
        error: friendlyError.message,
      },
      { status: friendlyError.status },
    );
  }

  const customer = Array.isArray(data) ? data[0] : data;

  return Response.json({
    ok: true,
    customer: customer
      ? {
          id: customer.id,
          full_name: customer.full_name,
          membership_status: customer.membership_status,
          created_at: customer.created_at,
        }
      : null,
  });
}

