import { supabase } from "@/lib/supabaseClient";
import type { Shop } from "@/types";

export const DEFAULT_CRISP_WEBSITE_ID = "90902ea5-80af-4468-8f9d-d9a808ed1137";

type ProfileRow = {
  full_name?: string | null;
  phone?: string | null;
};

type CrispWindow = Window & {
  $crisp?: unknown[];
  CRISP_WEBSITE_ID?: string;
  __listflowCrispLoader?: Promise<void>;
};

type CrispContext = {
  source?: string;
  locale?: string;
  section?: string;
  shops?: Shop[];
};

type SyncResult = {
  authenticated: boolean;
  email: string | null;
  fullName: string | null;
  phone: string | null;
};

const CRISP_HIDE_STYLE_IDS = [
  "listflow-landing-hide-crisp",
  "listflow-login-hide-crisp",
  "listflow-downloads-hide-crisp",
];

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const getCrispWindow = (): CrispWindow | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return window as CrispWindow;
};

export const removeCrispHideStyles = () => {
  if (typeof document === "undefined") {
    return;
  }

  for (const id of CRISP_HIDE_STYLE_IDS) {
    document.getElementById(id)?.remove();
  }
};

export const pushCrisp = (command: unknown[]) => {
  const crispWindow = getCrispWindow();
  if (!crispWindow) {
    return;
  }

  if (!Array.isArray(crispWindow.$crisp)) {
    crispWindow.$crisp = [];
  }

  crispWindow.$crisp.push(command);
};

export const ensureCrispScript = async (
  websiteId: string = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID ?? DEFAULT_CRISP_WEBSITE_ID
) => {
  const crispWindow = getCrispWindow();
  if (!crispWindow || typeof document === "undefined") {
    return;
  }

  if (!Array.isArray(crispWindow.$crisp)) {
    crispWindow.$crisp = [];
  }

  crispWindow.CRISP_WEBSITE_ID = websiteId;

  if (crispWindow.__listflowCrispLoader) {
    await crispWindow.__listflowCrispLoader;
    return;
  }

  const existingScript = document.getElementById("crisp-chat-script") as HTMLScriptElement | null;
  if (existingScript) {
    crispWindow.__listflowCrispLoader = Promise.resolve();
    await crispWindow.__listflowCrispLoader;
    return;
  }

  crispWindow.__listflowCrispLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "crisp-chat-script";
    script.src = "https://client.crisp.chat/l.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Crisp script could not be loaded."));
    document.head.appendChild(script);
  }).catch((error) => {
    crispWindow.__listflowCrispLoader = undefined;
    throw error;
  });

  await crispWindow.__listflowCrispLoader;
};

export const hideCrispChat = (resetSession = false) => {
  pushCrisp(["do", "chat:hide"]);
  pushCrisp(["do", "chat:close"]);

  if (resetSession) {
    pushCrisp(["do", "session:reset", [false]]);
  }
};

const resolveStoreNames = (shops: Shop[] | undefined) =>
  (shops ?? [])
    .map((shop) => shop.name?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 8)
    .join(" | ");

export const syncCrispVisitorIdentity = async (context: CrispContext = {}): Promise<SyncResult> => {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    hideCrispChat(true);
    return {
      authenticated: false,
      email: null,
      fullName: null,
      phone: null,
    };
  }

  await ensureCrispScript();

  const email = typeof user.email === "string" && user.email.trim() ? user.email.trim() : null;
  let fullName =
    (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "") ||
    (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "") ||
    null;
  let phone =
    (typeof user.user_metadata?.phone === "string" ? user.user_metadata.phone.trim() : "") || null;

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("user_id", user.id)
      .maybeSingle<ProfileRow>();

    if (profile?.full_name?.trim()) {
      fullName = profile.full_name.trim();
    }

    if (profile?.phone?.trim()) {
      phone = profile.phone.trim();
    }
  } catch {
    // Profile tablosu okunamazsa auth metadata fallback yeterli.
  }

  if (email) {
    pushCrisp(["set", "user:email", [email]]);
  }

  if (fullName) {
    pushCrisp(["set", "user:nickname", [fullName]]);
  }

  if (phone) {
    pushCrisp(["set", "user:phone", [phone]]);
  }

  const storeNames = resolveStoreNames(context.shops);
  pushCrisp([
    "set",
    "session:data",
    [
      {
        listflow_user_id: user.id,
        listflow_user_email: email,
        listflow_user_phone: phone,
        listflow_user_name: fullName,
        listflow_source: context.source ?? null,
        listflow_section: context.section ?? null,
        listflow_locale: context.locale ?? null,
        listflow_store_count: context.shops?.length ?? 0,
        listflow_store_names: storeNames || null,
      },
    ],
  ]);

  return {
    authenticated: true,
    email,
    fullName,
    phone,
  };
};

export const openCrispChat = async (context: CrispContext = {}) => {
  removeCrispHideStyles();
  const identity = await syncCrispVisitorIdentity(context);

  if (!identity.authenticated) {
    return false;
  }

  pushCrisp(["do", "chat:show"]);
  pushCrisp(["do", "chat:open"]);

  await wait(180);

  pushCrisp(["do", "chat:show"]);
  pushCrisp(["do", "chat:open"]);
  return true;
};
