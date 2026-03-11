import { supabaseAdmin } from "@/lib/supabase/admin";

export type EtsyConnectionRecord = {
  id: string;
  environment: "prod";
  client_id: string;
  etsy_user_id: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  token_type: string | null;
  connected_at: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

const TABLE = "etsy_connections";
const DEFAULT_ENVIRONMENT = "prod" as const;

const isMissingTableError = (message: string | undefined) => {
  const normalized = (message ?? "").toLowerCase();
  return normalized.includes("relation") || normalized.includes("could not find the table");
};

export const getEtsyConnection = async () => {
  const query = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("environment", DEFAULT_ENVIRONMENT)
    .maybeSingle<EtsyConnectionRecord>();

  if (query.error) {
    if (isMissingTableError(query.error.message)) {
      return null;
    }
    throw new Error(query.error.message || "Etsy connection could not be loaded");
  }

  return query.data ?? null;
};

export const upsertEtsyConnection = async (args: {
  clientId: string;
  etsyUserId: string;
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
  tokenType?: string | null;
  connectedAt?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
}) => {
  const nowIso = new Date().toISOString();
  const payload = {
    environment: DEFAULT_ENVIRONMENT,
    client_id: args.clientId,
    etsy_user_id: args.etsyUserId,
    refresh_token: args.refreshToken,
    access_token: args.accessToken ?? null,
    access_token_expires_at: args.accessTokenExpiresAt ?? null,
    token_type: args.tokenType ?? null,
    connected_at: args.connectedAt ?? nowIso,
    created_by: args.createdBy ?? null,
    updated_by: args.updatedBy ?? args.createdBy ?? null,
    updated_at: nowIso,
  };

  const query = await supabaseAdmin
    .from(TABLE)
    .upsert(payload, { onConflict: "environment" })
    .select("*")
    .maybeSingle<EtsyConnectionRecord>();

  if (query.error) {
    throw new Error(query.error.message || "Etsy connection could not be saved");
  }

  if (!query.data) {
    throw new Error("Etsy connection could not be saved");
  }

  return query.data;
};

export const deleteEtsyConnection = async () => {
  const query = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("environment", DEFAULT_ENVIRONMENT);

  if (query.error) {
    throw new Error(query.error.message || "Etsy connection could not be deleted");
  }
};
