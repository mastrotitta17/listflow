"use client";

import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";

const EVENT_NAME = "listflow:native-push-token";

type NativePushPayload = {
  expoPushToken: string;
  platform: string;
  deviceName?: string | null;
  deviceModel?: string | null;
  osName?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  appBuild?: string | null;
  appId?: string | null;
  projectId?: string | null;
  locale?: string | null;
};

declare global {
  interface Window {
    __LISTFLOW_PENDING_PUSH_TOKEN__?: NativePushPayload | null;
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}

const normalizeString = (value: unknown) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
};

const isValidPayload = (value: unknown): value is NativePushPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Boolean(normalizeString(record.expoPushToken) && normalizeString(record.platform));
};

const syncServerSession = async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return false;
  }

  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    }),
  });

  return response.ok;
};

export default function MobileAppBridge() {
  const pendingPayloadRef = useRef<NativePushPayload | null>(null);
  const flushInFlightRef = useRef(false);

  const flushPendingToken = useCallback(async () => {
    if (flushInFlightRef.current || !pendingPayloadRef.current) {
      return;
    }

    flushInFlightRef.current = true;
    try {
      await syncServerSession();

      const response = await fetch("/api/mobile/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(pendingPayloadRef.current),
      });

      if (response.ok) {
        pendingPayloadRef.current = null;
        window.__LISTFLOW_PENDING_PUSH_TOKEN__ = null;
      }
    } finally {
      flushInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const handlePayload = (payload: NativePushPayload) => {
      pendingPayloadRef.current = payload;
      window.__LISTFLOW_PENDING_PUSH_TOKEN__ = payload;
      void flushPendingToken();
    };

    const handleEvent = (event: Event) => {
      const customEvent = event as CustomEvent<unknown>;
      if (!isValidPayload(customEvent.detail)) {
        return;
      }

      handlePayload(customEvent.detail);
    };

    window.addEventListener(EVENT_NAME, handleEvent as EventListener);

    if (isValidPayload(window.__LISTFLOW_PENDING_PUSH_TOKEN__)) {
      handlePayload(window.__LISTFLOW_PENDING_PUSH_TOKEN__);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void flushPendingToken();
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void flushPendingToken();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener(EVENT_NAME, handleEvent as EventListener);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      subscription.unsubscribe();
    };
  }, [flushPendingToken]);

  return null;
}
