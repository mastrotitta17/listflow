"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { buildOAuthRedirectTo } from "@/lib/auth/oauth-client";

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <path d="M21.35 11.1H12v2.98h5.35c-.23 1.5-1.12 2.78-2.38 3.64v2.42h3.84c2.25-2.07 3.54-5.13 3.54-8.77 0-.75-.07-1.48-.2-2.19Z" fill="#4285F4" />
    <path d="M12 22c3.02 0 5.55-1 7.4-2.71l-3.84-2.42c-1.07.72-2.44 1.15-3.56 1.15-2.73 0-5.05-1.84-5.88-4.32H2.16v2.48A10 10 0 0 0 12 22Z" fill="#34A853" />
    <path d="M6.12 13.7A5.98 5.98 0 0 1 5.8 12c0-.59.1-1.16.32-1.7V7.82H2.16A10 10 0 0 0 1 12c0 1.61.38 3.14 1.16 4.18l3.96-2.48Z" fill="#FBBC05" />
    <path d="M12 5.98c1.64 0 3.11.56 4.27 1.66l3.2-3.2C17.55 2.66 15.02 2 12 2A10 10 0 0 0 2.16 7.82L6.12 10.3c.83-2.48 3.15-4.32 5.88-4.32Z" fill="#EA4335" />
  </svg>
);

export default function ExtensionLinkPage() {
  const searchParams = useSearchParams();
  const sessionKey = searchParams?.get("session_key") ?? null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionKey) {
      setError("Geçersiz bağlantı. Lütfen eklentiden tekrar deneyin.");
    }
  }, [sessionKey]);

  const handleGoogleLogin = async () => {
    if (!sessionKey || loading) return;
    setLoading(true);
    setError(null);

    try {
      const redirectTo = buildOAuthRedirectTo(
        `/auth/callback?session_key=${encodeURIComponent(sessionKey)}&next=/auth/extension-done`
      );
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (oauthError) throw oauthError;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu. Tekrar deneyin.");
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 20% 20%, rgba(99,102,241,0.18), transparent 50%), radial-gradient(circle at 80% 80%, rgba(6,182,212,0.12), transparent 50%), #0a0a0c",
        padding: "16px",
        fontFamily: '"Inter", "Segoe UI", Arial, sans-serif',
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          border: "1px solid rgba(99,102,241,0.28)",
          borderRadius: 20,
          padding: "28px 24px",
          background: "linear-gradient(160deg, rgba(18,18,28,0.98), rgba(10,10,18,0.96))",
          boxShadow: "0 20px 48px rgba(0,0,0,0.5)",
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 11, border: "1px solid rgba(99,102,241,0.4)",
            background: "linear-gradient(135deg, #4338ca, #6366f1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 18px rgba(99,102,241,0.28)",
          }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" />
              <path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" />
              <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" />
            </svg>
          </div>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#f1f5f9", letterSpacing: "0.01em" }}>
            listflow<span style={{ color: "#818cf8" }}>.pro</span>
          </p>
        </div>

        <h1 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800, color: "#fff" }}>
          Eklenti Girişi
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
          Google hesabınla giriş yaparak eklentinizi etkinleştirin.
        </p>

        {error ? (
          <div style={{
            borderRadius: 10, padding: "10px 12px", marginBottom: 16,
            background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.3)",
            color: "#fda4af", fontSize: 12,
          }}>
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void handleGoogleLogin()}
          disabled={loading || !sessionKey}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            borderRadius: 11, border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.05)", color: "#f1f5f9",
            fontWeight: 700, fontSize: 14, padding: "11px 16px",
            cursor: loading || !sessionKey ? "not-allowed" : "pointer",
            opacity: loading || !sessionKey ? 0.6 : 1,
            fontFamily: "inherit",
          }}
        >
          {loading ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
              <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
              <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
            </svg>
          ) : <GoogleIcon />}
          {loading ? "Yönlendiriliyor…" : "Google ile Giriş Yap"}
        </button>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
