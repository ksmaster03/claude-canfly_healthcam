/** การ์ดแสดงค่าตรวจวัดหนึ่งช่อง (ธีมสว่าง) */
export type Tone = "neutral" | "good" | "warn" | "bad" | "muted";

const toneClass: Record<Tone, string> = {
  good: "text-emerald-600",
  warn: "text-amber-600",
  bad: "text-rose-600",
  neutral: "text-slate-800",
  muted: "text-slate-400",
};

export function MetricCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${toneClass[tone]}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
