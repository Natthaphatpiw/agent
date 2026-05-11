import {
  BadgeCheck,
  CheckCircle2,
  Clock3,
  FileText,
  HeartHandshake,
  LockKeyhole,
  PhoneCall,
  ShieldCheck,
} from "lucide-react";

import { ChatWidget } from "@/components/chat-widget";
import { InsuranceHero } from "@/components/insurance-hero";
import { MemberSignupForm } from "@/components/member-signup-form";

const coverageItems = [
  {
    title: "ข้อมูลสมาชิกปลอดภัย",
    description: "เก็บข้อมูลติดต่อ คำถามยืนยันตัวตน และสถานะสมาชิกอย่างเป็นระบบ",
    icon: LockKeyhole,
  },
  {
    title: "ตอบคำถามหลังการขาย",
    description: "ผู้ช่วยสมาชิกช่วยค้นข้อมูลและแนะนำขั้นตอนดูแลหลังการสมัคร",
    icon: HeartHandshake,
  },
  {
    title: "รองรับหลายช่องทาง",
    description: "เริ่มคุยบนเว็บและต่อยอดบริการผ่าน LINE OA ได้อย่างต่อเนื่อง",
    icon: PhoneCall,
  },
];

const benefitItems = [
  "สมัครสมาชิกได้ในหน้าเดียว",
  "ถามข้อมูลสมาชิกผ่านผู้ช่วยทันที",
  "พิมพ์หรือพูดเพื่อส่งคำถาม",
  "พร้อมรับข้อความจาก LINE OA",
];

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 md:px-8">
        <a href="#" className="flex items-center gap-3" aria-label="AgentCare หน้าแรก">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-950">AgentCare</p>
            <p className="text-xs text-slate-500">Customer Portal</p>
          </div>
        </a>

        <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
          <a className="transition hover:text-slate-950" href="#coverage">
            บริการ
          </a>
          <a className="transition hover:text-slate-950" href="#signup">
            สมัครสมาชิก
          </a>
          <a className="transition hover:text-slate-950" href="#line">
            LINE OA
          </a>
        </nav>

        <a
          href="#signup"
          className="inline-flex h-10 items-center justify-center rounded-md bg-teal-600 px-4 text-sm font-semibold text-white transition hover:bg-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
        >
          สมัครสมาชิก
        </a>
      </div>
    </header>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7faf9] text-slate-900">
      <Header />
      <InsuranceHero />

      <section id="coverage" className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-teal-700">
              <BadgeCheck className="h-4 w-4" aria-hidden="true" />
              บริการสมาชิก
            </div>
            <h2 className="max-w-xl text-3xl font-semibold leading-tight text-slate-950 md:text-4xl">
              ประสบการณ์หน้าเว็บแบบประกันภัยที่เรียบ สะอาด และพร้อมให้บริการสมาชิก
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              ลูกค้าสามารถสมัครสมาชิก สอบถามข้อมูล และรับบริการต่อเนื่องได้จากหน้าเดียว
              พร้อมประสบการณ์ที่สุภาพและใช้งานง่ายทั้งบนมือถือและเดสก์ท็อป
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {benefitItems.map((item) => (
                <div key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-1">
            {coverageItems.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.title}
                  className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-teal-50 text-teal-700">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-950">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-12 md:grid-cols-3 md:px-8">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-100 text-slate-800">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-semibold text-slate-950">ข้อมูลครบ</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">ฟอร์มรวบรวมข้อมูลสำคัญสำหรับการดูแลสมาชิก</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-100 text-slate-800">
              <Clock3 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-semibold text-slate-950">Session ต่อเนื่อง</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">บทสนทนาต่อเนื่องระหว่างการให้บริการในรอบเดียวกัน</p>
            </div>
          </div>
          <div className="flex items-start gap-4" id="line">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-100 text-slate-800">
              <PhoneCall className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-semibold text-slate-950">LINE OA พร้อมเชื่อม</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">ลูกค้าสามารถส่งข้อความเพื่อรับคำตอบผ่านบัญชีทางการ</p>
            </div>
          </div>
        </div>
      </section>

      <section id="signup" className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:px-8 md:py-20 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-teal-700">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Member Registration
          </div>
          <h2 className="max-w-xl text-3xl font-semibold leading-tight text-slate-950 md:text-4xl">
            สมัครสมาชิกเพื่อเริ่มรับบริการและยืนยันตัวตนกับผู้ช่วย
          </h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
            กรอกข้อมูลติดต่อและคำถามยืนยันตัวตนเพื่อให้ทีมบริการช่วยตรวจสอบและดูแลสมาชิกได้แม่นยำขึ้น
          </p>
        </div>
        <MemberSignupForm />
      </section>

      <footer className="border-t border-slate-200 bg-slate-950 px-5 py-8 text-sm text-slate-300 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p>AgentCare Customer Portal for AgentCore MyAgent</p>
          <p>บริการสมาชิกออนไลน์สำหรับงานประกันภัยและหลังการขาย</p>
        </div>
      </footer>

      <ChatWidget />
    </main>
  );
}
