"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Status = "pending" | "success" | "error";

const parseFragment = (hash: string): Record<string, string> => {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const result: Record<string, string> = {};
  for (const part of fragment.split("&")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    result[decodeURIComponent(part.slice(0, idx))] = decodeURIComponent(part.slice(idx + 1));
  }
  return result;
};

export default function ExtensionDonePage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("pending");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const sessionKey = searchParams?.get("session_key") ?? null;
    const authError = searchParams?.get("authError") ?? null;

    // No session_key → plain web login redirect, just show success.
    if (!sessionKey) {
      setStatus(authError ? "error" : "success");
      if (authError) setErrorMsg(authError);
      return;
    }

    // Extension implicit-flow: tokens are in the URL fragment.
    const fragments = parseFragment(window.location.hash);
    const accessToken = fragments["access_token"] ?? null;
    const refreshToken = fragments["refresh_token"] ?? null;

    if (!accessToken || !refreshToken) {
      setStatus("error");
      setErrorMsg("Token bulunamadı. Lütfen tekrar deneyin.");
      return;
    }

    // Post tokens to the oauth-complete endpoint so the extension poll can pick them up.
    fetch("/api/extension/oauth-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_key: sessionKey, access_token: accessToken, refresh_token: refreshToken }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`oauth-complete returned ${res.status}`);
        setStatus("success");
      })
      .catch((err: unknown) => {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Bilinmeyen hata.");
      });
  }, [searchParams]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0c",
        fontFamily: '"Inter", "Segoe UI", Arial, sans-serif',
      }}
    >
      <div style={{ textAlign: "center", padding: "32px 24px" }}>
        {status === "pending" && (
          <>
            <div style={{
              width: 56, height: 56, borderRadius: 16, margin: "0 auto 20px",
              background: "linear-gradient(135deg, #4338ca, #6366f1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 24px rgba(99,102,241,0.35)",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
                <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
              </svg>
            </div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#f1f5f9" }}>Giriş tamamlanıyor…</p>
          </>
        )}

        {status === "success" && (
          <>
            <div style={{
              width: 56, height: 56, borderRadius: 16, margin: "0 auto 20px",
              background: "linear-gradient(135deg, #059669, #10b981)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 24px rgba(16,185,129,0.35)",
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 900, color: "#f1f5f9" }}>Giriş Başarılı</p>
            <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              Bu sekmeyi kapatabilirsiniz.<br />
              Eklenti otomatik olarak güncellenecek.
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{
              width: 56, height: 56, borderRadius: 16, margin: "0 auto 20px",
              background: "linear-gradient(135deg, #dc2626, #ef4444)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 24px rgba(239,68,68,0.35)",
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <p style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 900, color: "#f1f5f9" }}>Giriş Başarısız</p>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              {errorMsg ?? "Bir hata oluştu. Lütfen tekrar deneyin."}
            </p>
            <button
              onClick={() => window.close()}
              style={{
                padding: "8px 20px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.06)", color: "#f1f5f9",
                fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Kapat
            </button>
          </>
        )}

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
