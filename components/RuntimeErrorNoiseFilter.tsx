"use client";

import { useEffect } from "react";

const TARGET_MESSAGES = [
  "addCopyButton is not defined",
  "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
];

function includesAny(value: string, needles: string[]) {
  const lower = value.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

function isExtensionContext(value: string) {
  if (!value) return false;
  return includesAny(value, ["chrome-extension://", "moz-extension://", "content-script.js", "VM"]);
}

function isIgnorable(message: string, context: string) {
  if (!message) return false;
  if (!TARGET_MESSAGES.some((targetMessage) => message.includes(targetMessage))) return false;
  return isExtensionContext(context) || isExtensionContext(message);
}

export default function RuntimeErrorNoiseFilter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const message = event.message || event.error?.message || "";
      const context = [event.filename || "", event.error?.stack || ""].join("\n");
      if (!isIgnorable(message, context)) return;
      event.preventDefault();
      event.stopImmediatePropagation?.();
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = typeof reason === "string" ? reason : reason?.message || "";
      const context = typeof reason === "string" ? "" : reason?.stack || "";
      if (!isIgnorable(message, context)) return;
      event.preventDefault();
    };

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection, true);

    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection, true);
    };
  }, []);

  return null;
}
