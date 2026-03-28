import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import type {
  CalendarRole,
  CalendarShareLink,
  CalendarShareMember,
  SharedCalendarMeta,
} from "@/types";

const SHARING_STORAGE_KEY = "grass-secretary-calendar-sharing";
const DEFAULT_CALENDAR_ID = "calendar-local-1";
const OWNER_USER_ID = "owner-local";
const OWNER_NAME = "あなた";

const MEMBER_COLORS = ["#3B82F6", "#A855F7", "#F97316", "#14B8A6", "#E11D48", "#06B6D4"];

function toDate(value: Date | string | undefined): Date {
  if (!value) {
    return new Date();
  }
  return value instanceof Date ? value : new Date(value);
}

function createToken(): string {
  const entropy = Math.random().toString(36).slice(2, 12);
  return `gs-share-${Date.now().toString(36)}-${entropy}`;
}

function pickMemberColor(email: string, existingCount: number): string {
  let seed = 0;
  for (let index = 0; index < email.length; index += 1) {
    seed += email.charCodeAt(index);
  }
  return MEMBER_COLORS[(seed + existingCount) % MEMBER_COLORS.length];
}

function normalizeMember(member: CalendarShareMember): CalendarShareMember {
  return {
    ...member,
    color: member.color || MEMBER_COLORS[0],
    invitedAt: toDate(member.invitedAt),
    updatedAt: toDate(member.updatedAt),
  };
}

function normalizePublicLink(link: CalendarShareLink | null): CalendarShareLink | null {
  if (!link) {
    return null;
  }
  return {
    ...link,
    role: link.role || "VIEWER_FULL",
    enabled: Boolean(link.enabled),
    token: link.token,
    createdAt: toDate(link.createdAt),
    updatedAt: toDate(link.updatedAt),
    expiresAt: link.expiresAt ? toDate(link.expiresAt) : undefined,
  };
}

function normalizeMeta(meta: SharedCalendarMeta): SharedCalendarMeta {
  return {
    calendarId: meta.calendarId || DEFAULT_CALENDAR_ID,
    owner: {
      userId: meta.owner?.userId || OWNER_USER_ID,
      displayName: meta.owner?.displayName || OWNER_NAME,
      email: meta.owner?.email,
    },
    members: Array.isArray(meta.members) ? meta.members.map(normalizeMember) : [],
    publicLink: normalizePublicLink(meta.publicLink),
  };
}

function isValidEmail(email: string): boolean {
  return /.+@.+\..+/.test(email);
}

interface UseCalendarSharingReturn {
  sharing: SharedCalendarMeta;
  ownerUserId: string;
  inviteMember: (input: {
    email: string;
    displayName?: string;
    role: Exclude<CalendarRole, "OWNER">;
  }) => { ok: true; member: CalendarShareMember } | { ok: false; reason: string };
  updateMemberRole: (
    memberId: string,
    role: Exclude<CalendarRole, "OWNER">,
  ) => { ok: true } | { ok: false; reason: string };
  removeMember: (memberId: string) => void;
  setPublicLinkEnabled: (enabled: boolean) => CalendarShareLink;
  setPublicLinkRole: (role: "VIEWER_FULL" | "VIEWER_FREE_BUSY") => CalendarShareLink;
  regeneratePublicLinkToken: () => CalendarShareLink;
  getPublicShareUrl: (baseUrl?: string) => string | null;
  resolvePublicRoleByToken: (token: string) => "VIEWER_FULL" | "VIEWER_FREE_BUSY" | null;
}

export function useCalendarSharing(): UseCalendarSharingReturn {
  const [storedSharing, setStoredSharing] = useLocalStorage<SharedCalendarMeta>(
    SHARING_STORAGE_KEY,
    {
      calendarId: DEFAULT_CALENDAR_ID,
      owner: {
        userId: OWNER_USER_ID,
        displayName: OWNER_NAME,
      },
      members: [],
      publicLink: null,
    },
  );

  const sharing = useMemo(() => normalizeMeta(storedSharing), [storedSharing]);

  const inviteMember = useCallback(
    (input: { email: string; displayName?: string; role: Exclude<CalendarRole, "OWNER"> }) => {
      const normalizedEmail = input.email.trim().toLowerCase();
      if (!isValidEmail(normalizedEmail)) {
        return { ok: false as const, reason: "メールアドレス形式が不正です" };
      }

      const duplicate = sharing.members.find(
        (member) => member.email?.toLowerCase() === normalizedEmail,
      );
      if (duplicate) {
        return { ok: false as const, reason: "すでに共有済みのユーザーです" };
      }

      const now = new Date();
      const member: CalendarShareMember = {
        id: `share-member-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId: `member-${Date.now().toString(36)}`,
        email: normalizedEmail,
        displayName: input.displayName?.trim() || normalizedEmail.split("@")[0],
        role: input.role,
        color: pickMemberColor(normalizedEmail, sharing.members.length),
        invitedAt: now,
        updatedAt: now,
      };

      setStoredSharing((prev) => {
        const normalized = normalizeMeta(prev);
        return {
          ...normalized,
          members: [...normalized.members, member],
        };
      });

      return { ok: true as const, member };
    },
    [setStoredSharing, sharing.members],
  );

  const updateMemberRole = useCallback(
    (memberId: string, role: Exclude<CalendarRole, "OWNER">) => {
      const exists = sharing.members.some((member) => member.id === memberId);
      if (!exists) {
        return { ok: false as const, reason: "対象ユーザーが見つかりません" };
      }

      setStoredSharing((prev) => {
        const normalized = normalizeMeta(prev);
        return {
          ...normalized,
          members: normalized.members.map((member) =>
            member.id === memberId ? { ...member, role, updatedAt: new Date() } : member,
          ),
        };
      });

      return { ok: true as const };
    },
    [setStoredSharing, sharing.members],
  );

  const removeMember = useCallback(
    (memberId: string) => {
      setStoredSharing((prev) => {
        const normalized = normalizeMeta(prev);
        return {
          ...normalized,
          members: normalized.members.filter((member) => member.id !== memberId),
        };
      });
    },
    [setStoredSharing],
  );

  const setPublicLinkEnabled = useCallback(
    (enabled: boolean): CalendarShareLink => {
      const now = new Date();
      const next =
        sharing.publicLink ??
        ({
          token: createToken(),
          enabled: false,
          role: "VIEWER_FULL",
          createdAt: now,
          updatedAt: now,
        } satisfies CalendarShareLink);

      const updated: CalendarShareLink = {
        ...next,
        enabled,
        updatedAt: now,
      };

      setStoredSharing((prev) => {
        const normalized = normalizeMeta(prev);
        return {
          ...normalized,
          publicLink: updated,
        };
      });

      return updated;
    },
    [setStoredSharing, sharing.publicLink],
  );

  const setPublicLinkRole = useCallback(
    (role: "VIEWER_FULL" | "VIEWER_FREE_BUSY"): CalendarShareLink => {
      const now = new Date();
      const next =
        sharing.publicLink ??
        ({
          token: createToken(),
          enabled: true,
          role: "VIEWER_FULL",
          createdAt: now,
          updatedAt: now,
        } satisfies CalendarShareLink);

      const updated: CalendarShareLink = {
        ...next,
        role,
        updatedAt: now,
      };

      setStoredSharing((prev) => {
        const normalized = normalizeMeta(prev);
        return {
          ...normalized,
          publicLink: updated,
        };
      });

      return updated;
    },
    [setStoredSharing, sharing.publicLink],
  );

  const regeneratePublicLinkToken = useCallback((): CalendarShareLink => {
    const now = new Date();
    const next =
      sharing.publicLink ??
      ({
        token: createToken(),
        enabled: true,
        role: "VIEWER_FULL",
        createdAt: now,
        updatedAt: now,
      } satisfies CalendarShareLink);

    const updated: CalendarShareLink = {
      ...next,
      token: createToken(),
      enabled: true,
      updatedAt: now,
    };

    setStoredSharing((prev) => {
      const normalized = normalizeMeta(prev);
      return {
        ...normalized,
        publicLink: updated,
      };
    });

    return updated;
  }, [setStoredSharing, sharing.publicLink]);

  const getPublicShareUrl = useCallback(
    (baseUrl?: string): string | null => {
      const link = sharing.publicLink;
      if (!link || !link.enabled || !link.token) {
        return null;
      }
      const origin = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
      const path = typeof window !== "undefined" ? window.location.pathname : "/";
      return `${origin}${path}?shareToken=${encodeURIComponent(link.token)}`;
    },
    [sharing.publicLink],
  );

  const resolvePublicRoleByToken = useCallback(
    (token: string): "VIEWER_FULL" | "VIEWER_FREE_BUSY" | null => {
      const link = sharing.publicLink;
      if (!link?.enabled || !token) {
        return null;
      }
      if (link.token !== token) {
        return null;
      }
      if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
        return null;
      }
      return link.role;
    },
    [sharing.publicLink],
  );

  return {
    sharing,
    ownerUserId: sharing.owner.userId,
    inviteMember,
    updateMemberRole,
    removeMember,
    setPublicLinkEnabled,
    setPublicLinkRole,
    regeneratePublicLinkToken,
    getPublicShareUrl,
    resolvePublicRoleByToken,
  };
}
