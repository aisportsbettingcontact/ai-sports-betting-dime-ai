import React, { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { useLocation } from "wouter";
import { AdminShell } from "@/pages/admin/AdminShell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { formatMutationError } from "@/lib/errorUtils";
import {
  Plus, Pencil, Trash2, Shield, User, Crown, RefreshCw,
  Eye, EyeOff, ChevronDown, ArrowUp, ArrowDown, ChevronsUpDown, X, LogOut, ShieldAlert, BarChart2,
} from "lucide-react";

type AppUserRow = {
  id: number;
  email: string;
  username: string;
  role: "owner" | "admin" | "handicapper" | "user";
  hasAccess: boolean;
  expiryDate: number | null;
  createdAt: Date;
  lastSignedIn: Date | null;
  termsAccepted: boolean;
  termsAcceptedAt: number | null;
  discordId: string | null;
  discordUsername: string | null;
  discordConnectedAt: number | null;
  manualDiscordId: string | null;
  // Stripe fields
  stripeCustomerId: string | null;
  stripePlanId: string | null;
  stripeSubscriptionId: string | null;
  pendingSetup: boolean;
};

const ROLE_ICONS = {
  owner:       <Crown className="w-3 h-3" />,
  admin:       <Shield className="w-3 h-3" />,
  handicapper: <BarChart2 className="w-3 h-3" />,
  user:        <User className="w-3 h-3" />,
};

const ROLE_COLORS = {
  owner:       "bg-card text-foreground border-border",
  admin:       "bg-card text-foreground border-border",
  handicapper: "bg-card text-primary border-primary",
  user:        "bg-card text-foreground border-border",
};

const EST_OPTS: Intl.DateTimeFormatOptions = { timeZone: "America/New_York" };

function formatExpiry(expiryDate: number | null) {
  if (!expiryDate) return "Lifetime";
  const d = new Date(expiryDate);
  // Full precision: MM/DD/YYYY HH:MM:SS AM/PM EST
  const date = d.toLocaleDateString("en-US", { ...EST_OPTS, month: "2-digit", day: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { ...EST_OPTS, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  return `${date} ${time} EST`;
}

function formatDate(d: Date | null) {
  if (!d) return "Never";
  const dt = new Date(d);
  // [STEP] Build MM/DD/YYYY date string in EST
  const date = dt.toLocaleDateString("en-US", { ...EST_OPTS, month: "2-digit", day: "2-digit", year: "numeric" });
  // [STEP] Build HH:MM AM/PM time string in EST
  const time = dt.toLocaleTimeString("en-US", { ...EST_OPTS, hour: "2-digit", minute: "2-digit", hour12: true });
  // [OUTPUT] Full format: MM/DD/YYYY HH:MM AM/PM EST
  return `${date} ${time} EST`;
}

type FormState = {
  email: string;
  username: string;
  password: string;
  role: "owner" | "admin" | "handicapper" | "user";
  hasAccess: boolean;
  expiryType: "lifetime" | "custom";
  expiryDateStr: string;
};

const defaultForm: FormState = {
  email: "",
  username: "",
  password: "",
  role: "user",
  hasAccess: true,
  expiryType: "lifetime",
  expiryDateStr: "",
};

// ── Column filter/sort types ──────────────────────────────────────────────────
type SortDir = "asc" | "desc" | null;
type ColKey = "username" | "email" | "role" | "access" | "expiry" | "terms" | "lastSignIn";

interface ColState {
  sort: SortDir;
  selected: Set<string>; // empty = all selected
}

// Dropdown that shows sort + multi-select checkboxes for a column
function ColFilterDropdown({
  label,
  colKey,
  options,
  state,
  onChange,
}: {
  label: string;
  colKey: ColKey;
  options: string[];
  state: ColState;
  onChange: (next: ColState) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const isFiltered = state.selected.size > 0;
  const isSorted = state.sort !== null;
  const isActive = isFiltered || isSorted;

  function toggleSort(dir: SortDir) {
    onChange({ ...state, sort: state.sort === dir ? null : dir });
  }

  function toggleOption(opt: string) {
    const next = new Set(state.selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange({ ...state, selected: next });
  }

  function selectAll() {
    onChange({ ...state, selected: new Set() });
  }

  function clearAll() {
    onChange({ sort: null, selected: new Set() });
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 group transition-colors ${
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <span className="text-xs font-semibold tracking-wider">{label}</span>
        <span className="flex flex-col gap-[1px]">
          {state.sort === "asc" ? (
            <ArrowUp className="w-3 h-3 text-primary" />
          ) : state.sort === "desc" ? (
            <ArrowDown className="w-3 h-3 text-primary" />
          ) : (
            <ChevronsUpDown className="w-3 h-3 opacity-40 group-hover:opacity-70" />
          )}
        </span>
        {isFiltered && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
        )}
        <ChevronDown className={`w-3 h-3 opacity-40 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] bg-card border border-border rounded-lg shadow-xl py-1">
          {/* Sort options */}
          <div className="px-2 py-1 border-b border-border">
            <p className="text-[10px] font-semibold text-muted-foreground tracking-wider mb-1 px-1">SORT</p>
            <button type="button" onClick={() => toggleSort("asc")}
              className={`flex items-center gap-2 w-full px-2 py-1 rounded text-xs transition-colors ${
                state.sort === "asc" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ArrowUp className="w-3 h-3" /> Ascending
            </button>
            <button type="button" onClick={() => toggleSort("desc")}
              className={`flex items-center gap-2 w-full px-2 py-1 rounded text-xs transition-colors ${
                state.sort === "desc" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ArrowDown className="w-3 h-3" /> Descending
            </button>
          </div>

          {/* Filter options */}
          <div className="px-2 py-1">
            <div className="flex items-center justify-between mb-1 px-1">
              <p className="text-[10px] font-semibold text-muted-foreground tracking-wider">FILTER</p>
              {isFiltered && (
                <button type="button" onClick={selectAll} className="text-[11px] text-primary hover:opacity-80 transition-opacity">
                  All
                </button>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {options.map((opt) => {
                const checked = state.selected.size === 0 || state.selected.has(opt);
                return (
                  <label
                    key={opt}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOption(opt)}
                      className="w-3 h-3 accent-primary"
                    />
                    <span className="text-xs text-foreground">{opt}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Clear all */}
          {isActive && (
            <div className="border-t border-border px-2 py-1">
              <button type="button" onClick={() => { clearAll(); setOpen(false); }}
                className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="w-3 h-3" /> Clear filters
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ── Sort helpers ─────────────────────────────────────────────────────────────
const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, handicapper: 2, user: 3 };

function getSortValue(u: AppUserRow, key: ColKey): string | number {
  switch (key) {
    case "username": return `@${u.username}`.toLowerCase();
    case "email": return u.email.toLowerCase();
    case "role": return ROLE_ORDER[u.role] ?? 99;
    case "access": return u.hasAccess ? 0 : 1;
    case "expiry":
      // null = Lifetime → treated as Infinity so it sorts last on asc
      return u.expiryDate === null ? Infinity : u.expiryDate;
    case "terms": return u.termsAccepted ? 0 : 1;
    case "lastSignIn":
      return u.lastSignedIn ? new Date(u.lastSignedIn).getTime() : 0;
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UserManagement() {
  const { appUser, loading } = useAppAuth();
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<AppUserRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AppUserRow | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [showPassword, setShowPassword] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Per-column filter/sort state
  const defaultColState = (): ColState => ({ sort: null, selected: new Set() });
  const [cols, setCols] = useState<Record<ColKey, ColState>>({
    username: defaultColState(),
    email: defaultColState(),
    role: defaultColState(),
    access: defaultColState(),
    expiry: defaultColState(),
    terms: defaultColState(),
    // [DEFAULT] Sort by last sign-in descending so most-recently-active users
    // appear at the top of the table immediately on load — no manual sort needed.
    lastSignIn: { sort: "desc", selected: new Set() },
  });

  function updateCol(key: ColKey, next: ColState) {
    setCols((prev) => ({ ...prev, [key]: next }));
  }

  const utils = trpc.useUtils();
  const { data: rawUsers = [], isLoading } = trpc.appUsers.listUsers.useQuery(undefined, {
    enabled: appUser?.role === "owner",
  });

  const createMutation = trpc.appUsers.createUser.useMutation({
    onSuccess: () => {
      utils.appUsers.listUsers.invalidate();
      setShowCreate(false);
      setForm(defaultForm);
      toast.success(`Account created — @${form.username} has been added.`);
    },
    onError: (e) => toast.error(formatMutationError(e)),
  });

  const updateMutation = trpc.appUsers.updateUser.useMutation({
    onSuccess: () => {
      utils.appUsers.listUsers.invalidate();
      setEditUser(null);
      setForm(defaultForm);
      toast.success("Account updated");
    },
    onError: (e) => toast.error(formatMutationError(e)),
  });

  const deleteMutation = trpc.appUsers.deleteUser.useMutation({
    onSuccess: () => {
      utils.appUsers.listUsers.invalidate();
      setDeleteConfirm(null);
      toast.success("Account deleted");
    },
    onError: (e) => toast.error(formatMutationError(e)),
  });

  const forceLogoutUserMutation = trpc.appUsers.forceLogoutUser.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`Session invalidated — @${rawUsers.find(u => u.id === vars.id)?.username ?? vars.id} will be logged out on next request.`);
    },
    onError: (e) => toast.error(formatMutationError(e)),
  });

  const disconnectDiscordMutation = trpc.appUsers.adminDisconnectDiscord.useMutation({
    onSuccess: (data) => {
      console.log(`[UserMgmt] ADMIN_DISCORD_DISCONNECT.SUCCESS: unlinked @${data.unlinkedDiscordUsername ?? data.unlinkedDiscordId}`);
      toast.success(`Discord account @${data.unlinkedDiscordUsername ?? data.unlinkedDiscordId} has been unlinked`);
      utils.appUsers.listUsers.invalidate();
    },
    onError: (err) => {
      console.error(`[UserMgmt] ADMIN_DISCORD_DISCONNECT.ERROR:`, err.message);
      toast.error(formatMutationError(err));
    },
  });
  const forceLogoutAllMutation = trpc.appUsers.forceLogoutAll.useMutation({
    onSuccess: (data) => {
      toast.success(`Force logout complete — ${data.usersAffected} session(s) invalidated. Your session is unaffected.`);
    },
    onError: (e) => toast.error(formatMutationError(e)),
  });

  const [forceLogoutAllConfirm, setForceLogoutAllConfirm] = useState(false);

  // ─── Discord Invite Link state ─────────────────────────────────────────────
  const [inviteModal, setInviteModal] = useState<{
    userId: number;
    username: string;
    inviteUrl: string;
    expiresAt: number;
  } | null>(null);
  const [inviteGenerating, setInviteGenerating] = useState<number | null>(null); // userId being generated
  const [inviteCopied, setInviteCopied] = useState(false);

  const generateInviteMutation = trpc.appUsers.generateDiscordInvite.useMutation({
    onSuccess: (data, variables) => {
      // Find the username for the modal
      const user = users.find((u) => u.id === variables.userId);
      setInviteModal({
        userId: variables.userId,
        username: user?.username ?? String(variables.userId),
        inviteUrl: data.inviteUrl,
        expiresAt: data.expiresAt,
      });
      setInviteGenerating(null);
      console.log(`[UserMgmt] DISCORD_INVITE.GENERATED: userId=${variables.userId} expiresAt=${new Date(data.expiresAt).toISOString()}`);
    },
    onError: (err) => {
      setInviteGenerating(null);
      toast.error(formatMutationError(err));
    },
  });

  const handleGenerateInvite = useCallback((userId: number) => {
    setInviteGenerating(userId);
    setInviteCopied(false);
    generateInviteMutation.mutate({ userId, origin: window.location.origin });
  }, [generateInviteMutation]);

  const handleCopyInvite = useCallback(async () => {
    if (!inviteModal) return;
    try {
      await navigator.clipboard.writeText(inviteModal.inviteUrl);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 3000);
      toast.success("Invite link copied to clipboard!");
    } catch {
      toast.error("Failed to copy. Please copy manually.");
    }
  }, [inviteModal]);

  // ─── Manual Discord ID inline edit state ─────────────────────────────────
  // editingDiscordId: userId currently being edited (null = none)
  // discordIdDraft: current value in the input field
  const [editingDiscordId, setEditingDiscordId] = React.useState<number | null>(null);
  const [discordIdDraft, setDiscordIdDraft] = React.useState("");

  const syncDiscordRoleMutation = trpc.appUsers.syncDiscordRole.useMutation({
    onSuccess: (result) => {
      console.log(`[UserMgmt][SyncDiscordRole][SUCCESS] action=${result.action} reason=${result.reason}`);
      toast.success(`Discord role synced: ${result.action}`);
      utils.appUsers.listUsers.invalidate();
    },
    onError: (err) => {
      console.error(`[UserMgmt][SyncDiscordRole][FAIL] error=${err.message}`);
      toast.error(formatMutationError(err));
    },
  });

  const setManualDiscordIdMutation = trpc.appUsers.setManualDiscordId.useMutation({
    onSuccess: (data) => {
      // data.immediate = true  → Discord resolved immediately, account fully connected
      // data.immediate = false → cleared or bot token missing (pending mode)
      if (data.immediate && data.discordUsername) {
        console.log(
          `[UserMgmt][AdminDiscordConnect][SUCCESS] userId=${data.userId}` +
          ` discordId="${data.discordId}" discordUsername="${data.discordUsername}"` +
          ` mode=IMMEDIATE_CONNECT`
        );
        toast.success(`✓ Discord connected: @${data.discordUsername}`);
      } else if (!data.discordId && !data.discordUsername) {
        console.log(
          `[UserMgmt][AdminDiscordConnect][CLEARED] userId=${data.userId} mode=CLEAR`
        );
        toast.success("Discord ID cleared.");
      } else {
        // Fallback: bot token missing — pending mode
        console.log(
          `[UserMgmt][AdminDiscordConnect][PENDING] userId=${data.userId} mode=PENDING`
        );
        toast.success("Discord ID saved. Will auto-link on next Discord login.");
      }
      setEditingDiscordId(null);
      setDiscordIdDraft("");
      utils.appUsers.listUsers.invalidate();
    },
    onError: (err) => {
      console.error(`[UserMgmt][AdminDiscordConnect][ERROR]`, err.message);
      toast.error(formatMutationError(err));
    },
  });

  function startEditDiscordId(user: AppUserRow) {
    console.log(
      `[UserMgmt][ManualDiscordId][EDIT_START] userId=${user.id} username=${user.username}` +
      ` currentManualDiscordId=${user.manualDiscordId ?? "null"}`
    );
    setEditingDiscordId(user.id);
    setDiscordIdDraft(user.manualDiscordId ?? "");
  }

  function cancelEditDiscordId() {
    console.log(`[UserMgmt][ManualDiscordId][EDIT_CANCEL] userId=${editingDiscordId}`);
    setEditingDiscordId(null);
    setDiscordIdDraft("");
  }

  function submitDiscordId(userId: number) {
    const trimmed = discordIdDraft.trim();
    console.log(
      `[UserMgmt][ManualDiscordId][SUBMIT] userId=${userId} value="${trimmed}"`
    );
    setManualDiscordIdMutation.mutate({ userId, discordId: trimmed });
  }

  // Redirect if not owner — MUST be in useEffect, never in render body
  // Calling navigate() during render crashes React 19 silently (blank screen)
  useEffect(() => {
    if (!loading && (!appUser || appUser.role !== "owner")) {
      console.warn(`[UserManagement] Unauthorized: user=${appUser?.username ?? "unauthenticated"} role=${appUser?.role ?? "none"} → redirecting to /feed/model/mlb`);
      navigate("/feed/model/mlb");
    }
  }, [loading, appUser, navigate]);

  function openCreate() {
    setForm(defaultForm);
    setShowCreate(true);
  }

  function openEdit(user: AppUserRow) {
    setForm({
      email: user.email,
      username: user.username,
      password: "",
      role: user.role,
      hasAccess: user.hasAccess,
      expiryType: user.expiryDate ? "custom" : "lifetime",
      expiryDateStr: user.expiryDate
        ? new Date(user.expiryDate).toISOString().slice(0, 16)
        : "",
    });
    setEditUser(user);
  }

  function buildExpiryDate(): number | null {
    if (form.expiryType === "lifetime") return null;
    if (!form.expiryDateStr) return null;
    return new Date(form.expiryDateStr).getTime();
  }

  function handleCreate() {
    createMutation.mutate({
      email: form.email,
      username: form.username.replace(/^@/, ""),
      password: form.password,
      role: form.role,
      hasAccess: form.hasAccess,
      expiryDate: buildExpiryDate(),
    });
  }

  function handleUpdate() {
    if (!editUser) return;
    const payload: Record<string, unknown> = { id: editUser.id };
    if (form.email !== editUser.email) payload.email = form.email;
    if (form.username.replace(/^@/, "") !== editUser.username) payload.username = form.username.replace(/^@/, "");
    if (form.password) payload.password = form.password;
    if (form.role !== editUser.role) payload.role = form.role;
    if (form.hasAccess !== editUser.hasAccess) payload.hasAccess = form.hasAccess;
    payload.expiryDate = buildExpiryDate();
    updateMutation.mutate(payload as Parameters<typeof updateMutation.mutate>[0]);
  }

  // ── Build unique option lists for each column ─────────────────────────────
  const opts: Record<ColKey, string[]> = {
    username: Array.from(new Set(rawUsers.map((u) => `@${u.username}`))).sort(),
    email: Array.from(new Set(rawUsers.map((u) => u.email))).sort(),
    role: ["owner", "admin", "user"],
    access: ["YES", "NO"],
    expiry: Array.from(new Set(rawUsers.map((u) => formatExpiry(u.expiryDate)))).sort(),
    terms: ["ACCEPTED", "PENDING"],
    lastSignIn: Array.from(new Set(rawUsers.map((u) => formatDate(u.lastSignedIn)))).sort(),
  };

  // ── Apply filters + sort ──────────────────────────────────────────────────
  function getDisplayVal(u: AppUserRow, key: ColKey): string {
    switch (key) {
      case "username": return `@${u.username}`;
      case "email": return u.email;
      case "role": return u.role;
      case "access": return u.hasAccess ? "YES" : "NO";
      case "expiry": return formatExpiry(u.expiryDate);
      case "terms": return u.termsAccepted ? "ACCEPTED" : "PENDING";
      case "lastSignIn": return formatDate(u.lastSignedIn);
    }
  }

  let users = [...rawUsers];

  // Apply search
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase().replace(/^@/, "");
    users = users.filter(
      (u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }

  // Apply column filters
  (Object.keys(cols) as ColKey[]).forEach((key) => {
    const { selected } = cols[key];
    if (selected.size > 0) {
      users = users.filter((u) => selected.has(getDisplayVal(u, key)));
    }
  });

  // Apply sorts — last active sort wins, using typed sort values
  const activeSorts = (Object.keys(cols) as ColKey[])
    .filter((k) => cols[k].sort !== null)
    .map((k) => ({ key: k, dir: cols[k].sort! }));

  if (activeSorts.length > 0) {
    const { key, dir } = activeSorts[activeSorts.length - 1];
    users.sort((a, b) => {
      const av = getSortValue(a, key);
      const bv = getSortValue(b, key);
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }

  // Show loading skeleton while auth is resolving OR while redirect is pending
  // This prevents both the blank screen and the flash of unauthorized content
  if (loading || (!loading && (!appUser || appUser.role !== "owner"))) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center gap-3">
        <RefreshCw className="w-5 h-5 text-foreground animate-spin" />
        <span className="text-sm text-foreground">{loading ? "Authenticating..." : "Redirecting..."}</span>
      </div>
    );
  }

  return (
    <AdminShell active="users">
    <div className="w-full bg-muted/30 text-foreground flex flex-col">
      {/* Header — two-row on mobile, single-row on sm+ */}
      <div className="sticky top-14 z-40 bg-background/95 backdrop-blur border-b w-full supports-[backdrop-filter]:bg-background/80">
        {/* Row 1: Actions — back button and "USER MANAGEMENT" title removed
            (now owned by AdminShell's back-to-app affordance + tab nav) */}
        <div className="w-full px-3 sm:px-5 lg:px-8 pt-3 pb-1.5 sm:pb-0 flex items-center gap-2">
          <div className="flex-1" />
          {/* Actions — hidden on mobile, shown inline on sm+ */}
          <div className="hidden sm:flex items-center gap-2">
            <Button
              onClick={() => setForceLogoutAllConfirm(true)}
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={forceLogoutAllMutation.isPending}
            >
              {forceLogoutAllMutation.isPending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <LogOut className="w-4 h-4" />
              )}
              Force Logout All
            </Button>
            <Button
              onClick={() => navigate("/admin/security")}
              size="sm"
              variant="outline"
              className="gap-1.5"
            >
              <ShieldAlert className="w-4 h-4" />
              Security Events
            </Button>
            <Button onClick={openCreate} size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" />
              New Account
            </Button>
          </div>
        </div>
        {/* Row 2 (mobile only): Action buttons in a full-width row */}
        <div className="sm:hidden w-full px-3 pb-2.5 flex items-center gap-2">
          <Button
            onClick={() => setForceLogoutAllConfirm(true)}
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5 text-xs"
            disabled={forceLogoutAllMutation.isPending}
          >
            {forceLogoutAllMutation.isPending ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogOut className="w-3.5 h-3.5" />
            )}
            Force Logout All
          </Button>
          <Button
            onClick={() => navigate("/admin/security")}
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5 text-xs"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Security Events
          </Button>
          <Button onClick={openCreate} size="sm" className="flex-1 gap-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" />
            New Account
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex-1 w-full px-3 sm:px-5 lg:px-8 py-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Accounts overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage access, roles, subscriptions, and connected services.</p>
        </div>
        {/*
          5 cards: use grid-cols-3 on mobile so layout is 3+2 (no orphan).
          xs:grid-cols-3 ensures the 3-col layout kicks in at 480px.
          sm:grid-cols-5 shows all 5 in a single row on tablet+.
        */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3 mb-4 sm:mb-6">
          {[
            { label: "Total Accounts", value: rawUsers.length },
            { label: "Owners", value: rawUsers.filter((u) => u.role === "owner").length },
            { label: "Admins", value: rawUsers.filter((u) => u.role === "admin").length },
            { label: "Handicappers", value: rawUsers.filter((u) => u.role === "handicapper").length },
            { label: "Active Access", value: rawUsers.filter((u) => u.hasAccess).length },
          ].map((stat) => (
            <Card key={stat.label} className="min-w-0 gap-2 py-4 shadow-sm">
              <CardHeader className="px-4 pb-0">
                <CardTitle className="text-xs font-medium text-muted-foreground truncate">{stat.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <div className="text-2xl font-bold tabular-nums truncate">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search bar */}
        <div className="mb-4 relative rounded-xl border bg-card p-3 shadow-sm">
          <svg className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by username or email…"
            className="w-full pl-9 pr-9"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")}
              className="absolute right-6 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filtered count indicator */}
        {users.length !== rawUsers.length && (
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Showing <span className="text-foreground font-semibold">{users.length}</span> of <span className="text-foreground font-semibold">{rawUsers.length}</span> accounts</span>
            <button type="button" onClick={() => {
                setSearchQuery("");
                setCols({
                  username: defaultColState(), email: defaultColState(), role: defaultColState(),
                  access: defaultColState(), expiry: defaultColState(), terms: defaultColState(),
                  lastSignIn: defaultColState(),
                });
              }}
              className="text-foreground hover:text-primary flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear all filters
            </button>
          </div>
        )}

        {/* Table */}
        <div className="bg-card border border-border/20 rounded-xl overflow-hidden w-full shadow-sm">
          <div className="overflow-x-auto w-full">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>
                  <ColFilterDropdown label="USERNAME" colKey="username" options={opts.username} state={cols.username} onChange={(s) => updateCol("username", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="EMAIL" colKey="email" options={opts.email} state={cols.email} onChange={(s) => updateCol("email", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="ROLE" colKey="role" options={opts.role} state={cols.role} onChange={(s) => updateCol("role", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="ACCESS" colKey="access" options={opts.access} state={cols.access} onChange={(s) => updateCol("access", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="EXPIRY" colKey="expiry" options={opts.expiry} state={cols.expiry} onChange={(s) => updateCol("expiry", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="TERMS" colKey="terms" options={opts.terms} state={cols.terms} onChange={(s) => updateCol("terms", s)} />
                </TableHead>
                <TableHead>
                  <ColFilterDropdown label="LAST SIGN IN" colKey="lastSignIn" options={opts.lastSignIn} state={cols.lastSignIn} onChange={(s) => updateCol("lastSignIn", s)} />
                </TableHead>
                <TableHead className="text-foreground font-semibold tracking-wider text-xs">PLAN</TableHead>
                <TableHead className="text-foreground font-semibold tracking-wider text-xs">DISCORD STATUS</TableHead>
                <TableHead className="text-foreground font-semibold tracking-wider text-xs">DISCORD USERNAME</TableHead>
                <TableHead className="text-foreground font-semibold tracking-wider text-xs text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-foreground">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading accounts...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-foreground">
                    {rawUsers.length === 0 ? "No accounts yet. Create the first one." : "No accounts match the current filters."}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id} className="border-border hover:bg-muted">
                    <TableCell className="font-semibold text-foreground">@{user.username}</TableCell>
                    <TableCell className="text-foreground text-sm">{user.email}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${ROLE_COLORS[user.role]}`}>
                        {ROLE_ICONS[user.role]}
                        {user.role.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${
                        user.hasAccess
                          ? "bg-card text-primary border-primary"
                          : "bg-card text-foreground border-border"
                      }`}>
                        {user.hasAccess ? "YES" : "NO"}
                      </span>
                    </TableCell>
                    <TableCell className="text-foreground text-sm">{formatExpiry(user.expiryDate)}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${
                          user.termsAccepted
                            ? "bg-card text-primary border-primary"
                            : "bg-card text-foreground border-border"
                        }`}
                        title={user.termsAccepted && user.termsAcceptedAt ? `Accepted: ${new Date(user.termsAcceptedAt).toLocaleString()}` : "Not yet accepted"}
                      >
                        {user.termsAccepted ? "ACCEPTED" : "PENDING"}
                      </span>
                    </TableCell>
                    <TableCell className="text-foreground text-sm">{formatDate(user.lastSignedIn)}</TableCell>
                    {/* PLAN column */}
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {user.stripeCustomerId ? (
                          <>
                            {user.stripePlanId ? (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${
                                user.stripePlanId === 'annual'
                                  ? 'bg-card text-foreground border-border'
                                  : 'bg-card text-foreground border-border'
                              }`}>
                                {user.stripePlanId === 'annual' ? '★ ANNUAL' : 'MONTHLY'}
                              </span>
                            ) : (
                              <span className="text-[10px] text-foreground">Stripe</span>
                            )}
                            {user.pendingSetup && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-card text-foreground border border-border">
                                ⏳ PENDING SETUP
                              </span>
                            )}
                            <a
                              href={`https://dashboard.stripe.com/customers/${user.stripeCustomerId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-foreground hover:text-foreground transition-colors"
                              title="View in Stripe Dashboard"
                            >
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                              Stripe
                            </a>
                          </>
                        ) : (
                          <span className="text-[10px] text-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    {/* DISCORD STATUS column */}
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${
                          user.discordId
                            ? "bg-card text-foreground border-border"
                            : "bg-card text-foreground border-border"
                        }`}
                        title={user.discordId && user.discordConnectedAt
                          ? `Discord ID: ${user.discordId} · Linked: ${new Date(user.discordConnectedAt).toLocaleString()}`
                          : "Discord not connected"}
                      >
                        {user.discordId ? (
                          <>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0">
                              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.11 18.1.132 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                            </svg>
                            Connected
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleGenerateInvite(user.id)}
                            disabled={inviteGenerating === user.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-card hover:bg-muted text-foreground hover:text-foreground border border-border hover:border-border transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Generate a unique Discord invite link for this user"
                          >
                            {inviteGenerating === user.id ? (
                              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                              </svg>
                            ) : (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                              </svg>
                            )}
                            {inviteGenerating === user.id ? "Generating..." : "Generate Invite Link"}
                          </button>
                        )}
                      </span>
                    </TableCell>
                    {/* DISCORD USERNAME column */}
                    <TableCell className="text-sm">
                      {user.discordUsername ? (
                        <span className="text-foreground font-medium">@{user.discordUsername}</span>
                      ) : editingDiscordId === user.id ? (
                        /* ── Inline Discord ID input ──────────────────────────── */
                        <div className="flex items-center gap-1 min-w-0">
                          <input
                            type="text"
                            autoFocus
                            value={discordIdDraft}
                            onChange={(e) => setDiscordIdDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") submitDiscordId(user.id);
                              if (e.key === "Escape") cancelEditDiscordId();
                            }}
                            placeholder="Discord ID (e.g. 123456789012345678)"
                            className="w-44 px-2 py-0.5 text-xs rounded bg-card border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:border-border focus:ring-1 focus:ring-primary"
                            disabled={setManualDiscordIdMutation.isPending}
                          />
                          <button
                            type="button"
                            onClick={() => submitDiscordId(user.id)}
                            disabled={setManualDiscordIdMutation.isPending}
                            className="p-1 rounded bg-card hover:bg-muted text-foreground transition-colors disabled:opacity-50"
                            title="Save Discord ID"
                          >
                            {setManualDiscordIdMutation.isPending
                              ? <span className="text-[10px]">…</span>
                              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                            }
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditDiscordId}
                            className="p-1 rounded hover:bg-muted text-foreground hover:text-foreground transition-colors"
                            title="Cancel"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ) : (
                        /* ── Not editing: show pre-registered ID or clickable dash ── */
                        <button
                          type="button"
                          onClick={() => startEditDiscordId(user)}
                          className="group flex items-center gap-1 text-foreground hover:text-foreground transition-colors"
                          title="Click to connect Discord ID"
                        >
                          <span className="text-foreground group-hover:text-foreground">—</span>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-0 group-hover:opacity-60 transition-opacity"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => openEdit(user)}
                          className="p-1.5 rounded hover:bg-muted text-foreground hover:text-foreground transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => forceLogoutUserMutation.mutate({ id: user.id })}
                          className="p-1.5 rounded hover:bg-muted text-foreground hover:text-foreground transition-colors"
                          disabled={user.id === appUser?.id || forceLogoutUserMutation.isPending}
                          title="Force logout this user"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                        {/* OWNER-ONLY: Disconnect Discord button
                         * Only shown when user has a Discord account linked.
                         * Users cannot disconnect their own Discord — this is admin-only.
                         * Logs CHECKPOINT:ADMIN_DISCORD_DISCONNECT on the server. */}
                        {user.discordId && (
                          <button type="button" onClick={() => {
                              if (confirm(`Unlink Discord @${user.discordUsername ?? user.discordId} from ${user.username}?\n\nThis cannot be undone by the user — only you can re-link it.`)) {
                                console.log(`[UserMgmt] ADMIN_DISCORD_DISCONNECT.INITIATED: userId=${user.id} username=${user.username} discordUsername=${user.discordUsername}`);
                                disconnectDiscordMutation.mutate({ id: user.id });
                              }
                            }}
                            className="p-1.5 rounded hover:bg-muted text-foreground hover:text-foreground transition-colors"
                            disabled={disconnectDiscordMutation.isPending}
                            title={`Unlink Discord @${user.discordUsername ?? user.discordId}`}
                          >
                            {/* Discord logo icon — signals this is a Discord-specific action */}
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.11 18.1.132 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                            </svg>
                          </button>
                        )}
                        {/* Sync Discord Role button — only shown if user has a Discord ID */}
                        {(user.discordId || user.manualDiscordId) && (
                          <button
                            type="button"
                            onClick={() => {
                              console.log(`[UserMgmt][SyncDiscordRole][INITIATED] userId=${user.id} username=${user.username} hasAccess=${user.hasAccess}`);
                              syncDiscordRoleMutation.mutate({ userId: user.id });
                            }}
                            disabled={syncDiscordRoleMutation.isPending}
                            className="p-1.5 rounded hover:bg-muted text-foreground hover:text-primary transition-colors disabled:opacity-50"
                            title="Sync Discord role (grant if hasAccess=true, revoke if false)"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${syncDiscordRoleMutation.isPending ? 'animate-spin' : ''}`} />
                          </button>
                        )}
                        {/* View in Stripe button — only shown if user has a Stripe customer ID */}
                        {user.stripeCustomerId && (
                          <a
                            href={`https://dashboard.stripe.com/customers/${user.stripeCustomerId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded hover:bg-muted text-foreground hover:text-foreground transition-colors"
                            title="View customer in Stripe Dashboard"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          </a>
                        )}
                        <button type="button" onClick={() => setDeleteConfirm(user)}
                          className="p-1.5 rounded hover:bg-muted text-foreground hover:text-foreground transition-colors"
                          disabled={user.id === appUser?.id}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
        </div>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={showCreate || !!editUser} onOpenChange={(open) => {
        if (!open) { setShowCreate(false); setEditUser(null); }
      }}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="tracking-wider">
              {editUser ? "EDIT ACCOUNT" : "CREATE ACCOUNT"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs tracking-wider">EMAIL</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com"
                className="bg-card border-border text-foreground placeholder:text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs tracking-wider">USERNAME</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground">@</span>
                <Input
                  value={form.username.replace(/^@/, "")}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder="username"
                  className="bg-card border-border text-foreground placeholder:text-foreground pl-7"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs tracking-wider">
                {editUser ? "NEW PASSWORD (leave blank to keep current)" : "PASSWORD"}
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  id="um-password"
                  name="new-password"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={editUser ? "Leave blank to keep current" : "Min 8 characters"}
                  className="bg-card border-border text-foreground placeholder:text-foreground pr-10"
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-foreground text-xs tracking-wider">ROLE</Label>
                <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as FormState["role"] }))}>
                  <SelectTrigger className="bg-card border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="handicapper">Handicapper</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-foreground text-xs tracking-wider">ACCESS</Label>
                <div className="flex items-center gap-2 h-10 px-3 bg-card border border-border rounded-md">
                  <Switch
                    checked={form.hasAccess}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, hasAccess: v }))}
                  />
                  <span className={`text-sm font-semibold ${form.hasAccess ? "text-primary" : "text-foreground"}`}>
                    {form.hasAccess ? "Yes" : "No"}
                  </span>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs tracking-wider">EXPIRY DATE</Label>
              <Select value={form.expiryType} onValueChange={(v) => setForm((f) => ({ ...f, expiryType: v as "lifetime" | "custom" }))}>
                <SelectTrigger className="bg-card border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="lifetime">Lifetime Access</SelectItem>
                  <SelectItem value="custom">Custom Date</SelectItem>
                </SelectContent>
              </Select>
              {form.expiryType === "custom" && (
                <Input
                  type="datetime-local"
                  value={form.expiryDateStr}
                  onChange={(e) => setForm((f) => ({ ...f, expiryDateStr: e.target.value }))}
                  className="bg-card border-border text-foreground mt-2"
                />
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setShowCreate(false); setEditUser(null); }}
              className="border-border text-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={editUser ? handleUpdate : handleCreate}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : editUser ? "Save Changes" : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Logout All Confirm Dialog */}
      <Dialog open={forceLogoutAllConfirm} onOpenChange={(open) => { if (!open) setForceLogoutAllConfirm(false); }}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle className="tracking-wider text-foreground flex items-center gap-2">
              <LogOut className="w-4 h-4" />
              FORCE LOGOUT ALL
            </DialogTitle>
          </DialogHeader>
          <p className="text-foreground text-sm py-2">
            This will immediately invalidate all active sessions for <span className="text-foreground font-semibold">every user except you</span>. They will be logged out on their next request.
          </p>
          <p className="text-foreground text-xs">
            Your own session will not be affected. Users can log back in normally.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setForceLogoutAllConfirm(false)} className="border-border text-foreground hover:text-foreground">
              Cancel
            </Button>
            <Button
              className="bg-card hover:bg-muted text-foreground"
              onClick={() => {
                forceLogoutAllMutation.mutate();
                setForceLogoutAllConfirm(false);
              }}
              disabled={forceLogoutAllMutation.isPending}
            >
              {forceLogoutAllMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Confirm Force Logout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Discord ID Pre-Registration Modal ──────────────────────────────── */}
      {/* Rendered OUTSIDE the table to escape overflow-hidden/whitespace-nowrap */}
      {/* constraints on TableCell. Fixed-position overlay anchored to viewport. */}
      {editingDiscordId !== null && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelEditDiscordId();
          }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-card backdrop-blur-sm" />
          {/* Modal box */}
          <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl p-5 w-[420px] max-w-[95vw]">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-foreground">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.11 18.1.132 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
                <span className="text-foreground font-semibold text-sm">Pre-Register Discord ID</span>
              </div>
              <button
                type="button"
                onClick={cancelEditDiscordId}
                className="p-1 rounded hover:bg-muted text-foreground hover:text-foreground transition-colors"
                title="Cancel (Escape)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* User context */}
            <div className="mb-3 text-xs text-foreground bg-card rounded-lg px-3 py-2">
              <span className="text-foreground font-medium">
                @{rawUsers.find(u => u.id === editingDiscordId)?.username ?? editingDiscordId}
              </span>
              <span className="ml-2 text-foreground">
                {rawUsers.find(u => u.id === editingDiscordId)?.email ?? ""}
              </span>
            </div>
            {/* Instructions */}
            <p className="text-xs text-foreground mb-3 leading-relaxed">
              Enter the user&apos;s Discord <span className="text-foreground font-medium">User ID</span> (17–20 digit snowflake).
              To find it: right-click their name in Discord → <span className="text-foreground">Copy User ID</span>.
              The account will be <span className="text-primary font-medium">immediately connected</span> — no login required from the user.
            </p>
            {/* Input */}
            <input
              type="text"
              autoFocus
              value={discordIdDraft}
              onChange={(e) => setDiscordIdDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && editingDiscordId !== null) submitDiscordId(editingDiscordId);
                if (e.key === "Escape") cancelEditDiscordId();
              }}
              placeholder="e.g. 123456789012345678"
              className="w-full px-3 py-2 text-sm rounded-lg bg-card border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:border-border focus:ring-2 focus:ring-primary transition-all mb-4"
              disabled={setManualDiscordIdMutation.isPending}
            />
            {/* Note about clearing */}
            <p className="text-xs text-foreground mb-3">
              Leave empty and save to clear a previously entered ID.
            </p>
            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={cancelEditDiscordId}
                className="px-3 py-1.5 text-xs rounded-lg bg-card hover:bg-muted text-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => editingDiscordId !== null && submitDiscordId(editingDiscordId)}
                disabled={setManualDiscordIdMutation.isPending}
                className="px-4 py-1.5 text-xs rounded-lg bg-card hover:bg-muted text-foreground font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {setManualDiscordIdMutation.isPending ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    Connect Discord
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle className="tracking-wider text-foreground">DELETE ACCOUNT</DialogTitle>
          </DialogHeader>
          <p className="text-foreground text-sm py-2">
            Are you sure you want to delete <span className="text-foreground font-semibold">@{deleteConfirm?.username}</span>? This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="border-border text-foreground hover:text-foreground">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate({ id: deleteConfirm.id })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ─── Discord Invite Link Modal ─────────────────────────────────────── */}
      {inviteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-card backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setInviteModal(null); }}
        >
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-foreground">Discord Invite Link</h2>
                <p className="text-sm text-foreground mt-0.5">
                  Send this link to <span className="text-foreground font-medium">@{inviteModal.username}</span> so they can connect their Discord account.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInviteModal(null)}
                className="p-1.5 rounded-lg hover:bg-muted text-foreground hover:text-foreground transition-colors flex-shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Invite URL box */}
            <div className="rounded-lg bg-card border border-border p-3 space-y-2">
              <p className="text-xs text-foreground font-medium uppercase tracking-wide">Invite URL (single-use · 7 days)</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-foreground break-all font-mono leading-relaxed">
                  {inviteModal.inviteUrl}
                </code>
              </div>
            </div>

            {/* Expiry notice */}
            <div className="flex items-center gap-2 text-xs text-foreground">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Expires: {new Date(inviteModal.expiresAt).toLocaleString()} · Single-use only
            </div>

            {/* How it works */}
            <div className="rounded-lg bg-card border border-border p-3 space-y-1.5">
              <p className="text-xs font-semibold text-foreground">How it works</p>
              <ol className="text-xs text-foreground space-y-1 list-decimal list-inside">
                <li>Send this link to <span className="text-foreground">@{inviteModal.username}</span></li>
                <li>They open it — Discord&#39;s Authorize screen appears</li>
                <li>They click Authorize — their Discord account is linked automatically</li>
                <li>They are redirected to <span className="text-foreground">/feed</span> and logged in</li>
              </ol>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCopyInvite}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground font-semibold text-sm transition-colors"
              >
                {inviteCopied ? (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    Copy Link
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setInviteModal(null)}
                className="px-5 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground hover:text-foreground font-medium text-sm transition-colors border border-border"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AdminShell>
  );
}
