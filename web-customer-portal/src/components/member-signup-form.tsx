"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

type FormState = {
  full_name: string;
  phone_number: string;
  email: string;
  address: string;
  security_question: string;
  security_answer: string;
  notes: string;
};

type RegisterResponse = {
  ok: boolean;
  error?: string;
  customer?: {
    id: string;
    full_name: string;
    membership_status: string;
  } | null;
};

const initialFormState: FormState = {
  full_name: "",
  phone_number: "",
  email: "",
  address: "",
  security_question: "",
  security_answer: "",
  notes: "",
};

function fieldClassName(hasError = false) {
  return [
    "w-full rounded-md border bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400",
    hasError
      ? "border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-100"
      : "border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-100",
  ].join(" ");
}

export function MemberSignupForm() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (
      !form.full_name.trim() ||
      !form.phone_number.trim() ||
      !form.security_question.trim() ||
      !form.security_answer.trim()
    ) {
      setError("กรุณากรอกชื่อ เบอร์โทร คำถามยืนยันตัวตน และคำตอบยืนยันตัวตน");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/customers/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      const result = (await response.json()) as RegisterResponse;

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "สมัครสมาชิกไม่สำเร็จ");
      }

      setSuccess(`บันทึกข้อมูลสมาชิก ${result.customer?.full_name ?? form.full_name} เรียบร้อยแล้ว`);
      setForm(initialFormState);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "สมัครสมาชิกไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:p-7"
    >
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">สมัครสมาชิกบริการลูกค้า</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            เริ่มต้นรับบริการและยืนยันข้อมูลสมาชิกได้อย่างสะดวก
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">ชื่อ-นามสกุล</span>
          <input
            className={fieldClassName()}
            value={form.full_name}
            onChange={(event) => updateField("full_name", event.target.value)}
            disabled={submitting}
            autoComplete="name"
            required
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">เบอร์โทรศัพท์</span>
          <input
            className={fieldClassName()}
            value={form.phone_number}
            onChange={(event) => updateField("phone_number", event.target.value)}
            disabled={submitting}
            autoComplete="tel"
            inputMode="tel"
            required
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">อีเมล</span>
          <input
            className={fieldClassName()}
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            disabled={submitting}
            autoComplete="email"
            inputMode="email"
            type="email"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">คำถามยืนยันตัวตน</span>
          <input
            className={fieldClassName()}
            value={form.security_question}
            onChange={(event) => updateField("security_question", event.target.value)}
            disabled={submitting}
            required
          />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">คำตอบยืนยันตัวตน</span>
          <input
            className={fieldClassName()}
            value={form.security_answer}
            onChange={(event) => updateField("security_answer", event.target.value)}
            disabled={submitting}
            type="password"
            required
          />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">ที่อยู่</span>
          <textarea
            className={fieldClassName()}
            value={form.address}
            onChange={(event) => updateField("address", event.target.value)}
            disabled={submitting}
            rows={3}
          />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">หมายเหตุ</span>
          <textarea
            className={fieldClassName()}
            value={form.notes}
            onChange={(event) => updateField("notes", event.target.value)}
            disabled={submitting}
            rows={3}
          />
        </label>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {success}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400 md:w-auto"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        สมัครสมาชิก
      </button>
    </form>
  );
}
