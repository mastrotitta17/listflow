"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  Copy,
  Gift,
  Loader2,
  Rocket,
  Share2,
  Sparkles,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "sonner";
import { ReferralPanelSkeleton } from "@/components/loading/PageSkeletons";

type Conversion = {
  id: string;
  status: "pending" | "qualified";
  signed_up_at: string;
  subscribed_at: string | null;
};

type Reward = {
  id: string;
  reward_type: "discount_20pct" | "cash_250";
  milestone: number;
  promo_code: string | null;
  status: "pending" | "issued" | "applied" | "expired";
  created_at: string;
};

type ReferralStats = {
  totalSignups: number;
  qualifiedCount: number;
  pendingCount: number;
};

type ReferralData = {
  code: string;
  stats: ReferralStats;
  conversions: Conversion[];
  rewards: Reward[];
};

// ── Confetti burst (emoji particles) ──────────────────────────────────────────
const CONFETTI_CHARS = ["🎉", "✨", "🌟", "🎊", "💫", "⭐"];

const ConfettiBurst = ({ active }: { active: boolean }) => {
  if (!active) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
      {Array.from({ length: 18 }).map((_, i) => (
        <motion.div
          key={i}
          initial={{
            x: `${30 + Math.random() * 40}vw`,
            y: "60vh",
            opacity: 1,
            scale: 1,
          }}
          animate={{
            x: `${10 + Math.random() * 80}vw`,
            y: `${-10 + Math.random() * -60}vh`,
            opacity: 0,
            scale: Math.random() * 1.5 + 0.5,
            rotate: Math.random() * 720 - 360,
          }}
          transition={{ duration: 1.2 + Math.random() * 0.8, ease: "easeOut" }}
          className="absolute text-2xl"
          style={{ left: 0, top: 0 }}
        >
          {CONFETTI_CHARS[i % CONFETTI_CHARS.length]}
        </motion.div>
      ))}
    </div>
  );
};

// ── Progress ring ──────────────────────────────────────────────────────────────
const ProgressRing = ({
  value,
  max,
  size = 80,
  strokeWidth = 6,
  color = "#6366f1",
}: {
  value: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / max, 1);
  const dashoffset = circumference * (1 - progress);

  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={dashoffset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
    </svg>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────
const ReferralPanel: React.FC = () => {
  const { locale } = useI18n();
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const confettiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isEn = locale === "en";

  const referralUrl = data?.code
    ? `https://listflow.pro/login?ref=${data.code}`
    : "";

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/referral");
      if (!res.ok) throw new Error("fetch failed");
      const json = (await res.json()) as ReferralData;
      setData(json);
    } catch {
      toast.error(isEn ? "Failed to load referral data." : "Referral verisi yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [isEn]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleCopyLink = async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setConfetti(true);
      if (confettiTimer.current) clearTimeout(confettiTimer.current);
      confettiTimer.current = setTimeout(() => setConfetti(false), 2200);
    } catch {
      toast.error(isEn ? "Copy failed." : "Kopyalama başarısız.");
    }
  };

  const handleCopyCode = async () => {
    if (!data?.code) return;
    try {
      await navigator.clipboard.writeText(data.code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      toast.error(isEn ? "Copy failed." : "Kopyalama başarısız.");
    }
  };

  const qualified = data?.stats.qualifiedCount ?? 0;
  const pending = data?.stats.pendingCount ?? 0;

  const milestone5Done = qualified >= 5;
  const milestone10Done = qualified >= 10;

  const reward5 = data?.rewards.find((r) => r.milestone === 5);
  const reward10 = data?.rewards.find((r) => r.milestone === 10);

  if (loading) {
    return <ReferralPanelSkeleton />;
  }

  return (
    <>
      <ConfettiBurst active={confetti} />

      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-10 py-8 space-y-8">

          {/* ── Hero Header ─────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="relative rounded-3xl overflow-hidden border border-indigo-500/20 bg-linear-to-br from-indigo-900/40 via-[#0d111b] to-cyan-900/20 p-8"
          >
            {/* Glow blobs */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -top-20 -left-20 h-64 w-64 rounded-full bg-indigo-500/15 blur-3xl" />
              <div className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
            </div>

            <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-indigo-600/20 border border-indigo-500/30 shadow-lg shadow-indigo-500/20">
                <Gift className="h-8 w-8 text-indigo-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 mb-1">
                  {isEn ? "Referral Program" : "Referral Programı"}
                </p>
                <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-tight">
                  {isEn
                    ? "Invite Friends, Earn Rewards"
                    : "Arkadaşlarını Davet Et, Ödül Kazan"}
                </h1>
                <p className="mt-2 text-sm text-slate-400 max-w-lg">
                  {isEn
                    ? "Get 5 friends to activate their first Pro or Turbo store and earn 20% off your next store. Reach 10 and get $250 cash."
                    : "5 arkadaşın ilk Pro veya Turbo mağazasını aktive etsin, bir sonraki mağazanda %20 indirim kazan. 10 kişiye ulaştığında $250 nakit kazanırsın."}
                </p>
              </div>
              {/* Stats pills */}
              <div className="flex flex-row sm:flex-col gap-2 shrink-0">
                <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                  <Users className="h-4 w-4 text-indigo-400" />
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                      {isEn ? "Signups" : "Kayıtlar"}
                    </p>
                    <p className="text-sm font-black text-white">{data?.stats.totalSignups ?? 0}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                  <Zap className="h-4 w-4 text-cyan-400" />
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                      {isEn ? "Qualified" : "Nitelikli"}
                    </p>
                    <p className="text-sm font-black text-white">{qualified}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Referral Link + QR ──────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            {/* Link card */}
            <div className="rounded-2xl border border-white/10 bg-[#0d111b] p-6 flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <Share2 className="h-5 w-5 text-indigo-400" />
                <h2 className="text-sm font-black uppercase tracking-widest text-white">
                  {isEn ? "Your Referral Link" : "Referral Linkin"}
                </h2>
              </div>

              {/* Link display */}
              <div className="rounded-xl bg-[#080c16] border border-white/8 px-4 py-3 flex items-center gap-3 min-w-0">
                <span className="flex-1 text-xs text-slate-300 font-mono truncate select-all">
                  {referralUrl || "…"}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  className="shrink-0 flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white transition-all cursor-pointer"
                >
                  {copied ? (
                    <><Check className="h-3 w-3" />{isEn ? "Copied!" : "Kopyalandı!"}</>
                  ) : (
                    <><Copy className="h-3 w-3" />{isEn ? "Copy" : "Kopyala"}</>
                  )}
                </button>
              </div>

              {/* Code display */}
              <div className="flex items-center gap-3">
                <div className="flex-1 rounded-xl bg-[#080c16] border border-white/8 px-4 py-3 flex items-center gap-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 shrink-0">
                    {isEn ? "Code" : "Kod"}
                  </p>
                  <span className="flex-1 text-base font-black tracking-[0.3em] text-indigo-300 font-mono">
                    {data?.code ?? "…"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyCode()}
                  className="shrink-0 flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-3 transition-all cursor-pointer"
                  title={isEn ? "Copy code" : "Kodu kopyala"}
                >
                  {codeCopied ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4 text-slate-400" />
                  )}
                </button>
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                {isEn
                  ? "Share this link with friends. Your milestone advances only when they activate their first store on a Pro or Turbo plan."
                  : "Bu linki arkadaşlarınla paylaş. İlerlemen yalnızca ilk mağazalarını Pro veya Turbo planla aktive ettiklerinde artar."}
              </p>
            </div>

            {/* QR card */}
            <div className="rounded-2xl border border-white/10 bg-[#0d111b] p-6 flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-cyan-400" />
                <h2 className="text-sm font-black uppercase tracking-widest text-white">
                  {isEn ? "QR Code" : "QR Kod"}
                </h2>
              </div>

              {/* QR code — styled like MFA authenticator setup */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setQrModalOpen(true)}
                  className="cursor-pointer group relative"
                  title={isEn ? "Click to enlarge" : "Büyütmek için tıkla"}
                >
                  <div className="relative h-[220px] w-[220px] rounded-[22px] bg-white p-4 shadow-[0_0_40px_rgba(99,102,241,0.25)] group-hover:shadow-[0_0_60px_rgba(99,102,241,0.4)] transition-all duration-300">
                    {data?.code ? (
                      <>
                        <QRCodeSVG
                          value={referralUrl}
                          size={188}
                          bgColor="#ffffff"
                          fgColor="#1e1b4b"
                          level="M"
                          includeMargin={false}
                        />
                        <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-indigo-300/40 bg-indigo-600 shadow-[0_0_20px_rgba(79,70,229,0.5)]">
                          <Rocket className="h-5 w-5 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                      </div>
                    )}
                  </div>
                  {/* Indigo glow corners */}
                  <div className="pointer-events-none absolute -inset-1 rounded-3xl border border-indigo-500/20" />
                </button>
              </div>

              <p className="text-center text-[11px] text-slate-500">
                {isEn
                  ? "Friends can scan this QR code to join with your referral link."
                  : "Arkadaşların bu QR kodu tarayarak referral linkiyle katılabilir."}
              </p>
            </div>
          </motion.div>

          {/* ── Milestones ──────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">
              {isEn ? "Milestones & Rewards" : "Kilometre Taşları & Ödüller"}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* Milestone 5 */}
              <div className={`relative rounded-2xl border p-6 flex gap-5 items-start overflow-hidden transition-all ${
                milestone5Done
                  ? "border-indigo-500/50 bg-linear-to-br from-indigo-900/30 to-[#0d111b]"
                  : "border-white/10 bg-[#0d111b]"
              }`}>
                {milestone5Done && (
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-indigo-500/20 blur-2xl" />
                  </div>
                )}
                <div className="relative shrink-0">
                  <ProgressRing value={Math.min(qualified, 5)} max={5} size={72} strokeWidth={5} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    {milestone5Done ? (
                      <Check className="h-5 w-5 text-indigo-300" />
                    ) : (
                      <span className="text-sm font-black text-white">{Math.min(qualified, 5)}/5</span>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-w-0 relative">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-indigo-400">
                      {isEn ? "Milestone 1" : "1. Hedef"}
                    </p>
                    {milestone5Done && (
                      <span className="rounded-full bg-indigo-600/30 border border-indigo-500/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-indigo-300">
                        {isEn ? "Unlocked!" : "Kazanıldı!"}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-black text-white mb-1">
                    {isEn ? "5 Qualified Referrals" : "5 Nitelikli Referral"}
                  </h3>
                  <p className="text-sm font-bold text-indigo-300">
                    {isEn ? "→ 20% off next store" : "→ Sonraki mağazada %20 indirim"}
                  </p>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {isEn
                      ? "A Stripe promo code applied to your next store subscription."
                      : "Bir sonraki mağaza aboneliğinize uygulanacak Stripe promo kodu."}
                  </p>
                  {reward5?.promo_code && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl bg-indigo-600/10 border border-indigo-500/20 px-3 py-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {isEn ? "Promo Code:" : "Promo Kod:"}
                      </span>
                      <span className="font-black tracking-widest text-indigo-300 font-mono text-sm">
                        {reward5.promo_code}
                      </span>
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(reward5.promo_code!).then(() => toast.success(isEn ? "Code copied!" : "Kod kopyalandı!"))}
                        className="ml-auto cursor-pointer"
                      >
                        <Copy className="h-3.5 w-3.5 text-slate-400 hover:text-white transition-colors" />
                      </button>
                    </div>
                  )}
                  {reward5?.status === "pending" && milestone5Done && !reward5.promo_code && (
                    <p className="mt-2 text-[11px] text-amber-400">
                      {isEn ? "Reward is being processed…" : "Ödül işleniyor…"}
                    </p>
                  )}
                </div>
              </div>

              {/* Milestone 10 */}
              <div className={`relative rounded-2xl border p-6 flex gap-5 items-start overflow-hidden transition-all ${
                milestone10Done
                  ? "border-amber-500/50 bg-linear-to-br from-amber-900/20 to-[#0d111b]"
                  : "border-white/10 bg-[#0d111b]"
              }`}>
                {milestone10Done && (
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-amber-500/15 blur-2xl" />
                  </div>
                )}
                <div className="relative shrink-0">
                  <ProgressRing
                    value={Math.min(qualified, 10)}
                    max={10}
                    size={72}
                    strokeWidth={5}
                    color={milestone10Done ? "#f59e0b" : "#6366f1"}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    {milestone10Done ? (
                      <Trophy className="h-5 w-5 text-amber-300" />
                    ) : (
                      <span className="text-sm font-black text-white">{Math.min(qualified, 10)}/10</span>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-w-0 relative">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-400">
                      {isEn ? "Milestone 2" : "2. Hedef"}
                    </p>
                    {milestone10Done && (
                      <span className="rounded-full bg-amber-600/30 border border-amber-500/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-300">
                        {isEn ? "Unlocked!" : "Kazanıldı!"}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-black text-white mb-1">
                    {isEn ? "10 Qualified Referrals" : "10 Nitelikli Referral"}
                  </h3>
                  <p className="text-sm font-bold text-amber-300">
                    {isEn ? "→ $250 Cash Reward" : "→ $250 Nakit Ödül"}
                  </p>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {isEn
                      ? "Cash payment will be processed within 7 business days."
                      : "Nakit ödeme 7 iş günü içinde işleme alınır."}
                  </p>
                  {reward10?.status === "pending" && milestone10Done && (
                    <p className="mt-2 text-[11px] text-amber-400">
                      {isEn ? "We'll contact you for payment details." : "Ödeme detayları için sizinle iletişime geçeceğiz."}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── How It Works ────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          >
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">
              {isEn ? "How It Works" : "Nasıl Çalışır?"}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                {
                  step: "01",
                  icon: Share2,
                  title: isEn ? "Share Your Link" : "Linkini Paylaş",
                  desc: isEn
                    ? "Copy your referral link or QR code and share it with friends."
                    : "Referral linkini veya QR kodunu kopyalayıp arkadaşlarınla paylaş.",
                  color: "text-indigo-400",
                  bg: "bg-indigo-500/10 border-indigo-500/20",
                },
                {
                  step: "02",
                  icon: Users,
                  title: isEn ? "Friends Sign Up" : "Arkadaşın Kayıt Olur",
                  desc: isEn
                    ? "Your friend registers with your link and activates their first store on a Pro or Turbo plan."
                    : "Arkadaşın linkinden kayıt olur ve ilk mağazasını Pro veya Turbo planla aktive eder.",
                  color: "text-cyan-400",
                  bg: "bg-cyan-500/10 border-cyan-500/20",
                },
                {
                  step: "03",
                  icon: Gift,
                  title: isEn ? "Earn Rewards" : "Ödülünü Kazan",
                  desc: isEn
                    ? "Hit milestones to unlock discount coupons and cash rewards."
                    : "Kilometre taşlarına ulaştıkça indirim kuponu ve nakit ödül kazan.",
                  color: "text-amber-400",
                  bg: "bg-amber-500/10 border-amber-500/20",
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="rounded-2xl border border-white/10 bg-[#0d111b] p-5 flex flex-col gap-4"
                >
                  <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${item.bg}`}>
                    <item.icon className={`h-5 w-5 ${item.color}`} />
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-600 mb-1">
                      {isEn ? "Step" : "Adım"} {item.step}
                    </p>
                    <h3 className="text-sm font-black text-white mb-1">{item.title}</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ── Conversion history ──────────────────────────────────── */}
          {(data?.conversions ?? []).length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4 }}
            >
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">
                {isEn ? "Recent Referrals" : "Son Referrallar"}
              </h2>
              <div className="rounded-2xl border border-white/10 bg-[#0d111b] overflow-hidden">
                <div className="divide-y divide-white/5">
                  {(data?.conversions ?? []).map((conv, i) => (
                    <div key={conv.id} className="flex items-center gap-4 px-5 py-3.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-[11px] font-black text-slate-400">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white">
                          {isEn ? "Referral #" : "Referral #"}{i + 1}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {isEn ? "Signed up:" : "Kayıt:"}{" "}
                          {new Date(conv.signed_up_at).toLocaleDateString(
                            locale === "tr" ? "tr-TR" : "en-US",
                            { day: "2-digit", month: "short", year: "numeric" }
                          )}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${
                        conv.status === "qualified"
                          ? "bg-green-500/15 border border-green-500/30 text-green-400"
                          : "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                      }`}>
                        {conv.status === "qualified"
                          ? (isEn ? "Qualified" : "Nitelikli")
                          : (isEn ? "Pending" : "Bekliyor")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {pending > 0 && (
                <p className="mt-3 text-[11px] text-slate-500 text-center">
                  {isEn
                    ? `${pending} referral(s) are pending — they need to activate their first store on a Pro or Turbo plan to qualify.`
                    : `${pending} referral bekliyor — nitelikli sayılmaları için ilk mağazalarını Pro veya Turbo planla aktive etmeleri gerekiyor.`}
                </p>
              )}
            </motion.div>
          )}

          {/* Empty state */}
          {(data?.conversions ?? []).length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="rounded-2xl border border-white/8 bg-[#0d111b]/60 p-10 flex flex-col items-center gap-4 text-center"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
                <Users className="h-7 w-7 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-base font-black text-white mb-1">
                  {isEn ? "No referrals yet" : "Henüz referral yok"}
                </h3>
                <p className="text-sm text-slate-500 max-w-xs">
                  {isEn
                    ? "Share your referral link above to start earning rewards!"
                    : "Ödül kazanmaya başlamak için yukarıdaki referral linkini paylaş!"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyLink()}
                className="mt-2 flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-white transition-all cursor-pointer"
              >
                <Share2 className="h-4 w-4" />
                {isEn ? "Copy My Link" : "Linkimi Kopyala"}
              </button>
            </motion.div>
          )}

        </div>
      </div>

      {/* ── QR Modal (full-size) ─────────────────────────────────── */}
      <AnimatePresence>
        {qrModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setQrModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.88, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 10 }}
              className="relative z-10 flex max-h-[min(92vh,calc(100dvh-1rem))] w-full max-w-lg flex-col items-center gap-5 overflow-y-auto rounded-[24px] border border-indigo-400/30 bg-[#101727] p-4 shadow-[0_30px_90px_rgba(5,10,28,0.85)] sm:rounded-3xl sm:p-8"
            >
              {/* Glow */}
              <div className="pointer-events-none absolute inset-0 rounded-3xl overflow-hidden">
                <div className="absolute -top-16 -left-10 h-36 w-36 rounded-full bg-indigo-500/20 blur-2xl" />
                <div className="absolute -bottom-16 -right-10 h-40 w-40 rounded-full bg-cyan-500/15 blur-2xl" />
              </div>

              <div className="relative">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300 mb-1 text-center">
                  listflow.pro
                </p>
                <h3 className="text-lg font-black text-white text-center mb-4">
                  {isEn ? "Scan to Join with My Link" : "Katılmak İçin Tara"}
                </h3>

                {/* QR wrapper — exactly like MFA authenticator style */}
                <div className="flex items-center justify-center">
                  <div className="relative">
                    {/* Outer decorative ring */}
                    <div className="absolute -inset-3 rounded-3xl border-2 border-indigo-500/30 bg-[#0a0f1e]" />
                    {/* White QR background */}
                    <div className="relative rounded-2xl bg-white p-4 shadow-[0_0_60px_rgba(99,102,241,0.35)]">
                      {data?.code && (
                        <>
                          <QRCodeSVG
                            value={referralUrl}
                            size={180}
                            bgColor="#ffffff"
                            fgColor="#1e1b4b"
                            level="M"
                            includeMargin={false}
                          />
                          <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border border-indigo-300/40 bg-indigo-600 shadow-[0_0_20px_rgba(79,70,229,0.5)]">
                            <Rocket className="h-6 w-6 text-white" />
                          </div>
                        </>
                      )}
                    </div>
                    {/* Corner accents */}
                    <div className="absolute -top-1 -left-1 h-4 w-4 rounded-tl-xl border-t-2 border-l-2 border-indigo-400/60" />
                    <div className="absolute -top-1 -right-1 h-4 w-4 rounded-tr-xl border-t-2 border-r-2 border-indigo-400/60" />
                    <div className="absolute -bottom-1 -left-1 h-4 w-4 rounded-bl-xl border-b-2 border-l-2 border-indigo-400/60" />
                    <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-br-xl border-b-2 border-r-2 border-indigo-400/60" />
                  </div>
                </div>

                <p className="mt-6 break-all text-center font-mono text-sm font-black tracking-[0.3em] text-indigo-300 sm:tracking-[0.4em]">
                  {data?.code}
                </p>
                <p className="mt-1 text-center text-[11px] text-slate-500">
                  {isEn ? "Referral code" : "Referral kodu"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="rounded-xl border border-white/15 px-6 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                {isEn ? "Close" : "Kapat"}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

export default ReferralPanel;
