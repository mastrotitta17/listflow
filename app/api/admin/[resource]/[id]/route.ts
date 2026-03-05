import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromRequest, getProfileByUserId, getUserFromAccessToken, isAdminRole } from "@/lib/auth/admin";
import { isAdminResource, ADMIN_RESOURCE_MAP } from "@/lib/admin/resources";
import { normalizeStoreNameInput } from "@/lib/stores/name";
import { supabaseAdmin } from "@/lib/supabase/admin";

const notFoundResponse = () => NextResponse.json({ error: "Not Found" }, { status: 404 });
const isMissingTableError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    message.includes("could not find the table") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
};

const isNotFoundError = (error: { message?: string; code?: string } | null | undefined) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("not found") || message.includes("no rows found");
};

const safeDeleteByUser = async (table: string, userId: string, userColumn = "user_id") => {
  const result = await supabaseAdmin.from(table).delete().eq(userColumn, userId);

  if (result.error && !isMissingTableError(result.error)) {
    throw new Error(result.error.message);
  }
};

const findAuthUsersByEmail = async (email: string) => {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const matches: Array<{ id: string; email: string | null }> = [];

  for (let page = 1; page <= 50; page += 1) {
    const listed = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (listed.error) {
      throw new Error(listed.error.message);
    }

    const users = listed.data?.users ?? [];
    for (const user of users) {
      if ((user.email ?? "").toLowerCase() === normalized) {
        matches.push({ id: user.id, email: user.email ?? null });
      }
    }

    if (users.length < 200) {
      break;
    }
  }

  return matches;
};

const requireAdmin = async (request: NextRequest) => {
  const token = getAccessTokenFromRequest(request);
  if (!token) return null;

  const user = await getUserFromAccessToken(token);
  if (!user) return null;

  const profile = await getProfileByUserId(user.id, token);
  if (!profile || !isAdminRole(profile.role)) return null;

  return { user, profile };
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  const { resource, id } = await params;
  if (!isAdminResource(resource)) return notFoundResponse();

  const { table, idColumn } = ADMIN_RESOURCE_MAP[resource];
  const body = (await request.json()) as Record<string, unknown>;
  if (resource === "stores" && typeof body.store_name === "string") {
    body.store_name = normalizeStoreNameInput(body.store_name);
  }

  const { data, error } = await supabaseAdmin
    .from(table)
    .update(body)
    .eq(idColumn, id)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: `Table ${table} does not exist in remote schema yet. Apply migrations first.` },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ row: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  const admin = await requireAdmin(request);
  if (!admin) return notFoundResponse();

  const { resource, id } = await params;
  if (!isAdminResource(resource)) return notFoundResponse();

  if (resource === "users") {
    try {
      const profileLookup = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("user_id", id)
        .maybeSingle<{ email?: string | null }>();

      const profileEmail =
        !profileLookup.error && typeof profileLookup.data?.email === "string"
          ? profileLookup.data.email.trim().toLowerCase()
          : null;

      await safeDeleteByUser("orders", id);
      await safeDeleteByUser("scheduler_jobs", id);
      await safeDeleteByUser("payments", id);
      await safeDeleteByUser("subscriptions", id);
      await safeDeleteByUser("stores", id);
      await safeDeleteByUser("referral_codes", id);
      await safeDeleteByUser("referral_rewards", id);
      await safeDeleteByUser("referral_conversions", id, "referrer_user_id");
      await safeDeleteByUser("referral_conversions", id, "referred_user_id");
      await safeDeleteByUser("profiles", id);

      const authDelete = await supabaseAdmin.auth.admin.deleteUser(id);
      if (authDelete.error && !isNotFoundError(authDelete.error)) {
        return NextResponse.json({ error: authDelete.error.message }, { status: 500 });
      }

      if (profileEmail) {
        const relatedAuthUsers = await findAuthUsersByEmail(profileEmail);
        for (const authUser of relatedAuthUsers) {
          if (!authUser?.id) {
            continue;
          }
          const cleanup = await supabaseAdmin.auth.admin.deleteUser(authUser.id);
          if (cleanup.error && !isNotFoundError(cleanup.error)) {
            return NextResponse.json({ error: cleanup.error.message }, { status: 500 });
          }
        }
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "User could not be deleted";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const { table, idColumn } = ADMIN_RESOURCE_MAP[resource];

  const { error } = await supabaseAdmin.from(table).delete().eq(idColumn, id);

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: `Table ${table} does not exist in remote schema yet. Apply migrations first.` },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
