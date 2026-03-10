"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

const SESSION_SYNC_INTERVAL_MS = 15 * 60 * 1000;

const syncServerSession = async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      }),
    });
    return;
  }

  await fetch("/api/auth/session", {
    method: "DELETE",
    credentials: "include",
    cache: "no-store",
  });
};

export default function AuthSessionKeeper() {
  useEffect(() => {
    let cancelled = false;

    const safeSync = async () => {
      if (cancelled) {
        return;
      }

      try {
        await syncServerSession();
      } catch {
        // Keep UI usable if background sync fails.
      }
    };

    void safeSync();

    const intervalId = window.setInterval(() => {
      void safeSync();
    }, SESSION_SYNC_INTERVAL_MS);

    const handleFocus = () => {
      void safeSync();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void safeSync();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void safeSync();
    });

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
