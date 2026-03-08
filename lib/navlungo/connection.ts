import { supabaseAdmin } from "@/lib/supabase/admin";
import { readNavlungoEnvironment, type NavlungoEnvironment } from "@/lib/navlungo/config";

export type NavlungoConnectionRecord = {
  id: string;
  environment: NavlungoEnvironment;
  client_id: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  connected_email: string | null;
  connected_at: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

const TABLE = "navlungo_connections";

const normalizeEnvironment = (value: string | null | undefined): NavlungoEnvironment => {
  return value === "prod" ? "prod" : "qa";
};

const isMissingTableError = (message: string | undefined) => {
  const normalized = (message ?? "").toLowerCase();
  return normalized.includes("relation") || normalized.includes("could not find the table");
};

export const getNavlungoConnection = async (environment = readNavlungoEnvironment()) => {
  const query = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("environment", environment)
    .maybeSingle<NavlungoConnectionRecord>();

  if (query.error) {
    if (isMissingTableError(query.error.message)) {
      return null;
    }
    throw new Error(query.error.message || "Navlungo connection could not be loaded");
  }

  if (!query.data) {
    return null;
  }

  return {
    ...query.data,
    environment: normalizeEnvironment(query.data.environment),
  } satisfies NavlungoConnectionRecord;
};

export const upsertNavlungoConnection = async (args: {
  environment?: NavlungoEnvironment;
  clientId: string;
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
  connectedEmail?: string | null;
  connectedAt?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
}) => {
  const nowIso = new Date().toISOString();
  const payload = {
    environment: args.environment ?? readNavlungoEnvironment(),
    client_id: args.clientId,
    refresh_token: args.refreshToken,
    access_token: args.accessToken ?? null,
    access_token_expires_at: args.accessTokenExpiresAt ?? null,
    connected_email: args.connectedEmail ?? null,
    connected_at: args.connectedAt ?? nowIso,
    created_by: args.createdBy ?? null,
    updated_by: args.updatedBy ?? args.createdBy ?? null,
    updated_at: nowIso,
  };

  const query = await supabaseAdmin
    .from(TABLE)
    .upsert(payload, { onConflict: "environment" })
    .select("*")
    .maybeSingle<NavlungoConnectionRecord>();

  if (query.error) {
    throw new Error(query.error.message || "Navlungo connection could not be saved");
  }

  if (!query.data) {
    throw new Error("Navlungo connection could not be saved");
  }

  return {
    ...query.data,
    environment: normalizeEnvironment(query.data.environment),
  } satisfies NavlungoConnectionRecord;
};

export const deleteNavlungoConnection = async (environment = readNavlungoEnvironment()) => {
  const query = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("environment", environment);

  if (query.error) {
    throw new Error(query.error.message || "Navlungo connection could not be deleted");
  }
};
