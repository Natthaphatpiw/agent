import { ArrowRight, Headphones, ShieldCheck } from "lucide-react";
import Image from "next/image";

export function InsuranceHero() {
  return (
    <section className="relative min-h-[560px] overflow-hidden bg-slate-950 md:min-h-[620px]">
      <Image
        src="https://images.unsplash.com/photo-1556745757-8d76bdb6984b?auto=format&fit=crop&w=1800&q=85"
        alt="ทีมบริการลูกค้ากำลังดูแลข้อมูลสมาชิก"
        fill
        priority
        sizes="100vw"
        className="object-cover opacity-55"
      />
      <div className="absolute inset-0 bg-[rgba(2,20,36,0.66)]" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(to_top,#f7faf9,rgba(247,250,249,0))]" />

      <div className="relative mx-auto flex min-h-[560px] max-w-7xl items-center px-5 py-20 md:min-h-[620px] md:px-8">
        <div className="max-w-3xl text-white">
          <div className="mb-6 flex items-center gap-3 text-sm font-medium text-teal-100">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            AgentCore Customer Service
          </div>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-white md:text-6xl">
            ดูแลสมาชิกและสิทธิประโยชน์อย่างมั่นใจในทุกช่องทาง
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-100 md:text-xl">
            ระบบบริการลูกค้าสำหรับงานประกันภัยและสมาชิก เชื่อมต่อ AgentCore เพื่อช่วยตรวจสอบข้อมูล
            ตอบคำถาม และดูแลหลังการขายได้ต่อเนื่องทั้งเว็บและ LINE OA
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              href="#signup"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-teal-500 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-200"
            >
              สมัครสมาชิก
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href="#coverage"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-white/35 bg-white/10 px-5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/18 focus:outline-none focus:ring-2 focus:ring-white/60"
            >
              <Headphones className="h-4 w-4" aria-hidden="true" />
              ดูบริการสมาชิก
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
