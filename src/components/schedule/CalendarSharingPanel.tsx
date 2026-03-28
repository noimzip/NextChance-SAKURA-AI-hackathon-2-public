import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  Copy,
  Globe,
  Link2,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UsersRound,
} from "lucide-react";
import type { CalendarRole, SharedCalendarMeta } from "@/types";

const ROLE_OPTIONS: Exclude<CalendarRole, "OWNER">[] = [
  "EDITOR",
  "VIEWER_FULL",
  "VIEWER_FREE_BUSY",
];

const ROLE_LABELS: Record<CalendarRole, string> = {
  OWNER: "OWNER（全権限）",
  EDITOR: "EDITOR（編集可）",
  VIEWER_FULL: "VIEWER_FULL（詳細閲覧）",
  VIEWER_FREE_BUSY: "VIEWER_FREE_BUSY（Bookedのみ）",
};

interface CalendarSharingPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sharing: SharedCalendarMeta;
  activeViewerMode: string;
  onActiveViewerModeChange: (mode: string) => void;
  onInviteMember: (input: {
    email: string;
    displayName?: string;
    role: Exclude<CalendarRole, "OWNER">;
  }) => { ok: true } | { ok: false; reason: string };
  onUpdateMemberRole: (memberId: string, role: Exclude<CalendarRole, "OWNER">) => void;
  onRemoveMember: (memberId: string) => void;
  onPublicLinkEnabledChange: (enabled: boolean) => void;
  onPublicLinkRoleChange: (role: "VIEWER_FULL" | "VIEWER_FREE_BUSY") => void;
  onRegeneratePublicLink: () => void;
  publicShareUrl: string | null;
}

export function CalendarSharingPanel({
  open,
  onOpenChange,
  sharing,
  activeViewerMode,
  onActiveViewerModeChange,
  onInviteMember,
  onUpdateMemberRole,
  onRemoveMember,
  onPublicLinkEnabledChange,
  onPublicLinkRoleChange,
  onRegeneratePublicLink,
  publicShareUrl,
}: CalendarSharingPanelProps) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<CalendarRole, "OWNER">>("VIEWER_FULL");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(max-width: 640px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    setIsMobile(media.matches);
    media.addEventListener("change", handleChange);

    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, []);

  const viewerOptions = useMemo(() => {
    const base = [
      {
        id: "owner",
        label: `${sharing.owner.displayName ?? "あなた"}（OWNER）`,
      },
    ];

    const memberOptions = sharing.members.map((member) => ({
      id: `member:${member.id}`,
      label: `${member.displayName ?? member.email ?? member.userId}（${member.role}）`,
      color: member.color,
    }));

    const publicOption = sharing.publicLink?.enabled
      ? [
          {
            id: "public",
            label: `公開リンク閲覧（${sharing.publicLink.role}）`,
          },
        ]
      : [];

    return [...base, ...memberOptions, ...publicOption];
  }, [sharing]);

  const activeViewerLabel =
    viewerOptions.find((option) => option.id === activeViewerMode)?.label ??
    viewerOptions[0]?.label ??
    "OWNER";

  useEffect(() => {
    if (viewerOptions.some((option) => option.id === activeViewerMode)) {
      return;
    }
    onActiveViewerModeChange("owner");
  }, [activeViewerMode, onActiveViewerModeChange, viewerOptions]);

  const handleInvite = () => {
    if (!inviteEmail.trim()) {
      setInviteError("メールアドレスを入力してください");
      setInviteSuccess(null);
      return;
    }

    const result = onInviteMember({
      email: inviteEmail.trim(),
      role: inviteRole,
    });

    if (!result.ok) {
      setInviteError(result.reason);
      setInviteSuccess(null);
      return;
    }

    setInviteEmail("");
    setInviteError(null);
    setInviteSuccess("招待を追加しました");
  };

  const handleCopyShareUrl = async () => {
    if (!publicShareUrl) {
      return;
    }

    try {
      await copyTextToClipboard(publicShareUrl);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy share URL", error);
    }
  };

  const panelBody = (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-border/60 p-4">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">共同編集ビュー</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          共有相手の視点で表示を確認できます（権限チェック/Booked表示の動作確認用）。
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <span className="truncate">{activeViewerLabel}</span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
            {viewerOptions.map((option) => (
              <DropdownMenuItem key={option.id} onClick={() => onActiveViewerModeChange(option.id)}>
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate">{option.label}</span>
                  {activeViewerMode === option.id && <Check className="h-4 w-4 text-primary" />}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </section>

      <section className="space-y-3 rounded-xl border border-border/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UsersRound className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">共有ユーザー</h3>
          </div>
          <Badge variant="outline" className="font-medium">
            {sharing.members.length}人
          </Badge>
        </div>

        {sharing.members.length === 0 ? (
          <p className="text-xs text-muted-foreground">まだ共有ユーザーはいません。</p>
        ) : (
          <ScrollArea className="max-h-52">
            <div className="space-y-2 pr-2">
              {sharing.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: member.color }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.displayName ?? member.email}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                        <span className="max-w-[9rem] truncate">{ROLE_LABELS[member.role]}</span>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {ROLE_OPTIONS.map((role) => (
                        <DropdownMenuItem
                          key={`${member.id}-${role}`}
                          onClick={() => onUpdateMemberRole(member.id, role)}
                        >
                          <div className="flex w-full items-center justify-between gap-2">
                            <span>{ROLE_LABELS[role]}</span>
                            {member.role === role && <Check className="h-4 w-4 text-primary" />}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemoveMember(member.id)}
                    aria-label="共有ユーザーを削除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border/60 p-4">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">ユーザー招待</h3>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="teammate@example.com"
            className="h-11"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11 justify-between gap-2 sm:min-w-44">
                <span className="truncate">{ROLE_LABELS[inviteRole]}</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {ROLE_OPTIONS.map((role) => (
                <DropdownMenuItem key={`invite-${role}`} onClick={() => setInviteRole(role)}>
                  <div className="flex w-full items-center justify-between gap-2">
                    <span>{ROLE_LABELS[role]}</span>
                    {inviteRole === role && <Check className="h-4 w-4 text-primary" />}
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button className="h-11 px-6 font-semibold" onClick={handleInvite}>
            招待
          </Button>
        </div>

        {(inviteError || inviteSuccess) && (
          <p className={cn("text-xs", inviteError ? "text-destructive" : "text-emerald-600")}>
            {inviteError ?? inviteSuccess}
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">公開URL（閲覧専用）</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              URLを知っているユーザーが閲覧できます（デフォルト: VIEWER_FULL）。
            </p>
          </div>

          <Switch
            checked={Boolean(sharing.publicLink?.enabled)}
            onCheckedChange={onPublicLinkEnabledChange}
            aria-label="公開URLを有効化"
          />
        </div>

        {sharing.publicLink?.enabled && (
          <>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">リンク権限</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                    {ROLE_LABELS[sharing.publicLink.role]}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {(["VIEWER_FULL", "VIEWER_FREE_BUSY"] as const).map((role) => (
                    <DropdownMenuItem
                      key={`public-${role}`}
                      onClick={() => onPublicLinkRoleChange(role)}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span>{ROLE_LABELS[role]}</span>
                        {sharing.publicLink?.role === role && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 p-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              <Input
                readOnly
                value={publicShareUrl ?? ""}
                className="h-9 border-0 bg-transparent px-0"
              />
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => {
                  void handleCopyShareUrl();
                }}
                disabled={!publicShareUrl}
                aria-label="共有URLをコピー"
              >
                {isCopied ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={onRegeneratePublicLink}
                aria-label="共有URLを再生成"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-[92vw] max-w-[92vw] overflow-y-auto p-5 sm:max-w-md"
        >
          <SheetHeader>
            <SheetTitle className="text-left text-xl font-bold">カレンダー共有設定</SheetTitle>
            <SheetDescription className="text-left">
              共有メンバー、権限、公開URLをまとめて管理します。
            </SheetDescription>
          </SheetHeader>
          <div className="mt-5">{panelBody}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">カレンダー共有設定</DialogTitle>
          <DialogDescription>共有ユーザー、権限、公開URLを一括で管理できます。</DialogDescription>
        </DialogHeader>
        {panelBody}
      </DialogContent>
    </Dialog>
  );
}
