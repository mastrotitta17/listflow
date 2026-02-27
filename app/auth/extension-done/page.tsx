export default function ExtensionDonePage() {
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
        <p style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 900, color: "#f1f5f9" }}>
          Giriş Başarılı
        </p>
        <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
          Bu sekmeyi kapatabilirsiniz.<br />
          Eklenti otomatik olarak güncellenecek.
        </p>
      </div>
    </div>
  );
}
