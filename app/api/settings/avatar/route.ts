import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getUserFromAccessToken } from "@/lib/auth/admin";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AVATAR_BUCKET = "profile-avatars";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type ProfileAvatarRow = {
  user_id: string;
  avatar_url?: string | null;
};

const getAccessToken = (request: NextRequest) => request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;

const ensureAuthorizedUser = async (request: NextRequest) => {
  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user = await getUserFromAccessToken(accessToken);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { accessToken, user };
};

const isMissingColumnError = (error: { message?: string } | null | undefined, column: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase());
};

const isRecoverableProfileColumnError = (error: { message?: string } | null | undefined) =>
  isMissingColumnError(error, "avatar_url");

const selectProfileAvatar = async (userId: string) => {
  const selectCandidates = ["user_id, avatar_url", "user_id"] as const;
  let lastError: { message?: string } | null = null;

  for (const select of selectCandidates) {
    const result = await supabaseAdmin
      .from("profiles")
      .select(select)
      .eq("user_id", userId)
      .maybeSingle<ProfileAvatarRow>();

    if (!result.error) {
      return result.data ?? null;
    }

    lastError = result.error;
    if (!isRecoverableProfileColumnError(result.error)) {
      throw new Error(result.error.message);
    }
  }

  throw new Error(lastError?.message ?? "Profile avatar could not be loaded");
};

const toAvatarExtension = (contentType: string) => {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
};

const extractBucketObjectPath = (url: string | null | undefined) => {
  if (!url) {
    return null;
  }

  const patterns = [
    "/storage/v1/object/public/profile-avatars/",
    "/profile-avatars/",
  ];

  for (const pattern of patterns) {
    const index = url.indexOf(pattern);
    if (index >= 0) {
      const path = url.slice(index + pattern.length).split("?")[0].trim();
      return path || null;
    }
  }

  return null;
};

const updateAvatarState = async (userId: string, avatarUrl: string | null) => {
  const authUserResult = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authUserResult.error || !authUserResult.data.user) {
    throw new Error(authUserResult.error?.message ?? "User could not be loaded");
  }

  const currentMetadata =
    typeof authUserResult.data.user.user_metadata === "object" && authUserResult.data.user.user_metadata !== null
      ? (authUserResult.data.user.user_metadata as Record<string, unknown>)
      : {};

  const authUpdate = await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...currentMetadata,
      avatar_url: avatarUrl,
    },
  });

  if (authUpdate.error) {
    throw new Error(authUpdate.error.message);
  }

  const payloadCandidates: Array<Record<string, unknown>> = [
    { user_id: userId, avatar_url: avatarUrl },
    { user_id: userId },
  ];

  let lastError: { message?: string } | null = null;

  for (const payload of payloadCandidates) {
    const result = await supabaseAdmin.from("profiles").upsert(payload, { onConflict: "user_id" });

    if (!result.error) {
      return;
    }

    lastError = result.error;
    if (!isRecoverableProfileColumnError(result.error)) {
      throw new Error(result.error.message);
    }
  }

  if (lastError) {
    throw new Error(lastError.message ?? "Profile avatar could not be saved");
  }
};

export async function POST(request: NextRequest) {
  try {
    const auth = await ensureAuthorizedUser(request);
    if ("error" in auth) {
      return auth.error;
    }

    const formData = await request.formData();
    const rawFile = formData.get("avatar");

    if (!(rawFile instanceof File)) {
      return NextResponse.json({ error: "Profil fotoğrafı dosyası bulunamadı." }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(rawFile.type)) {
      return NextResponse.json({ error: "Yalnızca PNG, JPG veya WEBP yükleyebilirsiniz." }, { status: 400 });
    }

    if (rawFile.size <= 0 || rawFile.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "Profil fotoğrafı en fazla 5 MB olabilir." }, { status: 400 });
    }

    const previousProfile = await selectProfileAvatar(auth.user.id);
    const previousAvatarPath = extractBucketObjectPath(previousProfile?.avatar_url ?? null);

    const fileBuffer = Buffer.from(await rawFile.arrayBuffer());
    const objectPath = `${auth.user.id}/${Date.now()}-${randomUUID()}.${toAvatarExtension(rawFile.type)}`;

    const uploadResult = await supabaseAdmin.storage
      .from(AVATAR_BUCKET)
      .upload(objectPath, fileBuffer, {
        cacheControl: "3600",
        contentType: rawFile.type,
        upsert: false,
      });

    if (uploadResult.error) {
      return NextResponse.json({ error: uploadResult.error.message }, { status: 500 });
    }

    const { data: publicUrlData } = supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath);
    const avatarUrl = publicUrlData.publicUrl;

    await updateAvatarState(auth.user.id, avatarUrl);

    if (previousAvatarPath && previousAvatarPath !== objectPath) {
      await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([previousAvatarPath]);
    }

    return NextResponse.json({ success: true, avatarUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profil fotoğrafı yüklenemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await ensureAuthorizedUser(request);
    if ("error" in auth) {
      return auth.error;
    }

    const previousProfile = await selectProfileAvatar(auth.user.id);
    const previousAvatarPath = extractBucketObjectPath(previousProfile?.avatar_url ?? null);

    await updateAvatarState(auth.user.id, null);

    if (previousAvatarPath) {
      await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([previousAvatarPath]);
    }

    return NextResponse.json({ success: true, avatarUrl: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profil fotoğrafı kaldırılamadı.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
