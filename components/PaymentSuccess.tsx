"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Rocket, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';

type VerifyState = 'loading' | 'ready' | 'error';

const PaymentSuccess: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<VerifyState>('loading');
  const confettiPieces = useMemo(
    () =>
      Array.from({ length: 48 }, (_, index) => ({
        id: index,
        left: (index * 17) % 100,
        delay: (index % 8) * 0.08,
        duration: 2.4 + (index % 5) * 0.35,
        drift: ((index % 9) - 4) * 12,
        rotate: 220 + (index % 7) * 45,
        color: ['#60a5fa', '#34d399', '#a78bfa', '#fbbf24', '#f472b6'][index % 5],
      })),
    []
  );

  const sessionId = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    return new URLSearchParams(window.location.search).get('session_id');
  }, []);

  useEffect(() => {
    let mounted = true;

    const verify = async () => {
      if (!sessionId) {
        if (mounted) {
          setState('error');
        }
        return;
      }

      for (let i = 0; i < 8; i += 1) {
        const response = await fetch('/api/billing/verify-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });

        const payload = await response.json();

        if (response.ok && payload?.isActive) {
          if (mounted) {
            setState('ready');
          }
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      if (mounted) {
        setState('error');
      }
    };

    void verify();

    return () => {
      mounted = false;
    };
  }, [sessionId]);

  return (
    <div className="relative flex min-h-screen min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#0a0a0c] p-4 sm:p-6">
      {state === 'ready' ? (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
          {confettiPieces.map((piece) => (
            <motion.span
              key={piece.id}
              className="absolute top-0 h-3 w-2 rounded-sm"
              style={{ left: `${piece.left}%`, backgroundColor: piece.color }}
              initial={{ y: -30, x: 0, opacity: 0, rotate: 0 }}
              animate={{
                y: ['-5vh', '105vh'],
                x: [0, piece.drift],
                opacity: [0, 1, 1, 0],
                rotate: [0, piece.rotate],
              }}
              transition={{
                duration: piece.duration,
                delay: piece.delay,
                repeat: Infinity,
                repeatDelay: 0.4,
                ease: 'linear',
              }}
            />
          ))}
        </div>
      ) : null}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-card-pro relative z-20 max-w-md w-full rounded-[28px] border border-emerald-500/20 p-6 text-center shadow-2xl sm:rounded-[48px] sm:p-10"
      >
        <div className="mx-auto mb-6 flex h-18 w-18 items-center justify-center rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 shadow-[0_0_40px_rgba(16,185,129,0.1)] sm:mb-8 sm:h-24 sm:w-24 sm:rounded-[32px]">
          {state === 'loading' && <Loader2 className="h-10 w-10 animate-spin text-emerald-400 sm:h-12 sm:w-12" />}
          {state === 'ready' && <CheckCircle2 className="h-10 w-10 text-emerald-400 sm:h-12 sm:w-12" />}
          {state === 'error' && <AlertCircle className="h-10 w-10 text-red-400 sm:h-12 sm:w-12" />}
        </div>

        {state === 'ready' && <h1 className="mb-4 text-2xl font-black tracking-tight text-white sm:text-3xl">{t('payment.title')}</h1>}
        {state === 'loading' && <h1 className="mb-4 text-2xl font-black tracking-tight text-white sm:text-3xl">{t('payment.waitingSync')}</h1>}
        {state === 'error' && <h1 className="mb-4 text-2xl font-black tracking-tight text-white sm:text-3xl">{t('payment.syncFailed')}</h1>}

        <p className="mb-8 text-sm font-medium leading-relaxed text-slate-400 sm:mb-10 sm:text-base">
          {state === 'ready' ? t('payment.subtitle') : t('payment.waitingSync')}
        </p>

        <div className="space-y-4">
          <button
            onClick={() => {
              window.location.href = '/';
            }}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-indigo-600 px-4 py-4 text-sm font-black uppercase tracking-widest text-white shadow-xl shadow-indigo-500/20 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer sm:py-5"
          >
            {t('payment.backToPanel')} <ArrowRight className="w-5 h-5" />
          </button>

          <div className="flex items-center justify-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
            <Rocket className="w-3 h-3 text-indigo-400" /> listflow.pro Premium
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default PaymentSuccess;
