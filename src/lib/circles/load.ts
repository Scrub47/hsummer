import "server-only";

import {
  circleTitle,
  isCircleStatus,
  isCircleType,
  type CircleStatus,
  type CircleType,
} from "@/lib/circles/fields";
import {
  AVATARS_BUCKET,
  AVATAR_SIGNED_URL_SECONDS,
  isDisplayableAvatarUrl,
  isOwnAvatarObjectPath,
} from "@/lib/profile/fields";
import type { Session } from "@/lib/supabase/session";

export type CircleSummary = {
  id: string;
  title: string;
  name: string | null;
  circleType: CircleType;
  status: CircleStatus;
  createdAt: string;
};

export type CircleMemberView = {
  userId: string;
  displayName: string;
  timezone: string;
  avatarUrl: string | null;
  joinedAt: string;
};

export type CircleInviteView = {
  id: string;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
};

export type CircleDetail = CircleSummary & {
  invite: CircleInviteView | null;
  members: CircleMemberView[];
  isDemo: boolean;
  /** A couple that already lost a member cannot mint another invite. */
  inviteClosed: boolean;
  /** This viewer's mute. Other people's mute stays off this object. */
  mutedUntil: string | null;
};

/**
 * Circles the signed-in person still belongs to. An error usually means the
 * week 3 migration has not been applied; the home page keeps working.
 */
export async function loadCircles(
  session: Session,
): Promise<
  { ok: true; circles: CircleSummary[] } | { ok: false; circles: [] }
> {
  const { data, error } = await session.supabase
    .from("circle_members")
    .select("circle_id")
    .eq("user_id", session.userId)
    .is("left_at", null);

  if (error) {
    console.error("Circle list failed.");
    return { ok: false, circles: [] };
  }

  const ids = (data ?? []).map((row) => row.circle_id);
  if (ids.length === 0) return { ok: true, circles: [] };

  const circles = await session.supabase
    .from("circles")
    .select("id, name, circle_type, status, created_at")
    .in("id", ids);

  if (circles.error) {
    console.error("Circle rows failed.");
    return { ok: false, circles: [] };
  }

  return {
    ok: true,
    circles: (circles.data ?? [])
      .map(toSummary)
      .filter((circle): circle is CircleSummary => circle !== null),
  };
}

/** One circle the caller belongs to, or null when they cannot see it. */
export async function loadCircle(
  session: Session,
  circleId: string,
): Promise<CircleDetail | null> {
  const circle = await session.supabase
    .from("circles")
    .select("id, name, circle_type, status, created_at, is_demo")
    .eq("id", circleId)
    .maybeSingle();

  if (circle.error || !circle.data) return null;
  const summary = toSummary(circle.data);
  if (!summary) return null;

  const members = await session.supabase
    .from("circle_members")
    .select("user_id, joined_at, left_at, muted_until")
    .eq("circle_id", circleId)
    .order("joined_at", { ascending: true });

  if (members.error) return null;

  const activeMembers = (members.data ?? []).filter(
    (row) => row.left_at === null,
  );
  const someoneLeft = (members.data ?? []).some((row) => row.left_at !== null);
  const memberIds = activeMembers.map((row) => row.user_id);
  const profiles =
    memberIds.length === 0
      ? { data: [], error: null }
      : await session.supabase
          .from("profiles")
          .select("id, display_name, avatar_path, timezone")
          .in("id", memberIds);

  if (profiles.error) return null;

  const profileById = new Map(
    (profiles.data ?? []).map((profile) => [profile.id, profile]),
  );

  const memberViews: CircleMemberView[] = [];
  for (const member of activeMembers) {
    const profile = profileById.get(member.user_id);
    memberViews.push({
      userId: member.user_id,
      displayName: profile?.display_name ?? "Member",
      timezone: profile?.timezone ?? "UTC",
      joinedAt: member.joined_at,
      avatarUrl: await memberAvatar(
        session,
        member.user_id,
        profile?.avatar_path ?? null,
      ),
    });
  }

  const invite = await session.supabase
    .from("circle_invites")
    .select("id, expires_at, max_uses, use_count, revoked_at")
    .eq("circle_id", circleId)
    .is("revoked_at", null)
    .maybeSingle();

  if (invite.error) return null;

  return {
    ...summary,
    isDemo: circle.data.is_demo === true,
    inviteClosed:
      summary.circleType === "couple" && someoneLeft && memberViews.length < 2,
    members: memberViews,
    mutedUntil:
      activeMembers.find((member) => member.user_id === session.userId)
        ?.muted_until ?? null,
    invite: invite.data
      ? {
          id: invite.data.id,
          expiresAt: invite.data.expires_at,
          maxUses: invite.data.max_uses,
          useCount: invite.data.use_count,
          revokedAt: invite.data.revoked_at,
        }
      : null,
  };
}

function toSummary(row: {
  id: string;
  name: string | null;
  circle_type: string;
  status: string;
  created_at: string;
}): CircleSummary | null {
  if (!isCircleType(row.circle_type) || !isCircleStatus(row.status)) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    title: circleTitle(row.name, row.circle_type),
    circleType: row.circle_type,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function memberAvatar(
  session: Session,
  userId: string,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  if (isDisplayableAvatarUrl(path) && path.startsWith("https://")) return path;
  if (!isOwnAvatarObjectPath(userId, path)) return null;

  const { data, error } = await session.supabase.storage
    .from(AVATARS_BUCKET)
    .createSignedUrl(path, AVATAR_SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl || !isDisplayableAvatarUrl(data.signedUrl)) {
    return null;
  }
  return data.signedUrl;
}
