import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { useLocation } from "wouter";
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
import {
  ArrowLeft, Plus, Pencil, Trash2, Shield, User, Crown, RefreshCw,
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
};

const ROLE_ICONS = {
  owner:       <Crown className="w-3 h-3" />,
  admin:       <Shield className="w-3 h-3" />,
  handicapper: <BarChart2 className="w-3 h-3" />,
  user:        <User className="w-3 h-3" />,
};

const ROLE_COLORS = {
  owner:       "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  admin:       "bg-blue-500/15 text-blue-400 border-blue-500/30",
  handicapper: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  user:        "bg-zinc-500/15 text-zinc-200 border-zinc-500/30",
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
          isActive ? "text-white" : "text-zinc-200 hover:text-zinc-200"
        }`}
      >
        <span className="text-xs font-semibold tracking-wider">{label}</span>
        <span className="flex flex-col gap-[1px]">
          {state.sort === "asc" ? (
            <ArrowUp className="w-3 h-3 text-blue-400" />
          ) : state.sort === "desc" ? (
            <ArrowDown className="w-3 h-3 text-blue-400" />
          ) : (
            <ChevronsUpDown className="w-3 h-3 opacity-40 group-hover:opacity-70" />
          )}
        </span>
        {isFiltered && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
        )}
        <ChevronDown className={`w-3 h-3 opacity-40 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl py-1">
          {/* Sort options */}
          <div className="px-2 py-1 border-b border-white/8">
            <p className="text-sm text-zinc-300 tracking-wider mb-1 px-1">SORT</p>
            <button type="button" onClick={() => toggleSort("asc")}
              className={`flex items-center gap-2 w-full px-2 py-1 rounded text-xs transition-colors ${
                state.sort === "asc" ? "bg-blue-500/20 text-blue-300" : "text-zinc-300 hover:bg-white/5"
              }`}
            >
              <ArrowUp className="w-3 h-3" /> Ascending
            </button>
            <button type="button" onClick={() => toggleSort("desc")}
              className={`flex items-center gap-2 w-full px-2 py-1 rounded text-xs transition-colors ${
                state.sort === "desc" ? "bg-blue-500/20 text-blue-300" : "text-zinc-300 hover:bg-white/5"
              }`}
            >
              <ArrowDown className="w-3 h-3" /> Descending
            </button>
          </div>

          {/* Filter options */}
          <div className="px-2 py-1">
            <div className="flex items-center justify-between mb-1 px-1">
              <p className="text-sm text-zinc-300 tracking-wider">FILTER</p>
              {isFiltered && (
                <button type="button" onClick={selectAll} className="text-sm text-blue-400 hover:text-blue-300">
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
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOption(opt)}
                      className="w-3 h-3 accent-blue-500"
                    />
                    <span className="text-xs text-zinc-300">{opt}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Clear all */}
          {isActive && (
            <div className="border-t border-white/8 px-2 py-1">
              <button type="button" onClick={() => { clearAll(); setOpen(false); }}
                className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10 transition-colors"
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

// ── Metrics Panel ───────────────────────────────────────────────────────────
/** Formats milliseconds → HH:MM:SS */
function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function MetricsPanel() {
  const { data: sessionData, isLoading: sessLoading } = trpc.metrics.getSessionMetrics.useQuery(undefined, {
    refetchInterval: 60_000, // refresh every 60s
  });
  const { data: memberData, isLoading: membLoading } = trpc.metrics.getMemberMetrics.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const loading = sessLoading || membLoading;

  const sessionKpis = [
    {
      label: "DAILY ACTIVE USERS",
      sublabel: "Unique logins in last 24 hours",
      value: loading ? "—" : String(sessionData?.dau ?? 0),
      color: "text-emerald-400",
      border: "border-emerald-500/20",
    },
    {
      label: "WEEKLY ACTIVE USERS",
      sublabel: "Unique logins in last 7 days",
      value: loading ? "—" : String(sessionData?.wau ?? 0),
      color: "text-blue-400",
      border: "border-blue-500/20",
    },
    {
      label: "MONTHLY ACTIVE USERS",
      sublabel: "Unique logins in last 30 days",
      value: loading ? "—" : String(sessionData?.mau ?? 0),
      color: "text-violet-400",
      border: "border-violet-500/20",
    },
    {
      label: "AVG SESSION DURATION",
      sublabel: "Avg active time per session",
      value: loading ? "—" : fmtDuration(sessionData?.avgSessionDurationMs ?? 0),
      color: "text-amber-400",
      border: "border-amber-500/20",
    },
  ];

  const memberKpis = [
    {
      label: "TOTAL PAYING MEMBERS",
      sublabel: "Active paid access (all tiers)",
      value: loading ? "—" : String(memberData?.totalPaying ?? 0),
      color: "text-yellow-400",
      border: "border-yellow-500/20",
    },
    {
      label: "LIFETIME MEMBERS",
      sublabel: "Never-expiring access accounts",
      value: loading ? "—" : String(memberData?.lifetimeMembers ?? 0),
      color: "text-orange-400",
      border: "border-orange-500/20",
    },
    {
      label: "NON-PAYING MEMBERS",
      sublabel: "Accounts without active access",
      value: loading ? "—" : String(memberData?.nonPaying ?? 0),
      color: "text-zinc-200",
      border: "border-zinc-500/20",
    },
    {
      label: "CONNECTED DISCORD USERS",
      sublabel: "Accounts with Discord linked",
      value: loading ? "—" : String(memberData?.discordConnected ?? 0),
      color: "text-indigo-400",
      border: "border-indigo-500/20",
    },
  ];

  return (
    <div className="mb-6 space-y-3">
      {/* Section label */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-[0.15em] text-zinc-400 uppercase">Platform Metrics</span>
        <div className="flex-1 h-px bg-white/8" />
        {loading && <RefreshCw className="w-3 h-3 text-zinc-400 animate-spin" />}
      </div>

      {/* Row 1 — Session KPIs: 2-col mobile, 4-col sm+ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {sessionKpis.map((k) => (
          <div key={k.label} className={`bg-white/3 border ${k.border} rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0 overflow-hidden`}>
            {/* Value: font-mono for fixed-width digits, truncate prevents overflow */}
            <div className={`text-base sm:text-xl font-bold font-mono ${k.color} truncate`}>{k.value}</div>
            {/* Label: fixed xs size — sm:text-xs was backwards (larger on mobile) */}
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-zinc-300 mt-0.5 leading-tight">{k.label}</div>
            <div className="text-[10px] sm:text-xs text-zinc-400 mt-0.5 leading-tight">{k.sublabel}</div>
          </div>
        ))}
      </div>
      {/* Row 2 — Member KPIs: 2-col mobile, 4-col sm+ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {memberKpis.map((k) => (
          <div key={k.label} className={`bg-white/3 border ${k.border} rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0 overflow-hidden`}>
            <div className={`text-base sm:text-xl font-bold font-mono ${k.color} truncate`}>{k.value}</div>
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-zinc-300 mt-0.5 leading-tight">{k.label}</div>
            <div className="text-[10px] sm:text-xs text-zinc-400 mt-0.5 leading-tight">{k.sublabel}</div>
          </div>
        ))}
      </div>
    </div>
  );
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
    lastSignIn: defaultColState(),
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
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.appUsers.updateUser.useMutation({
    onSuccess: () => {
      utils.appUsers.listUsers.invalidate();
      setEditUser(null);
      setForm(defaultForm);
      toast.success("Account updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.appUsers.deleteUser.useMutation({
    onSuccess: () => {
      utils.appUsers.listUsers.invalidate();
      setDeleteConfirm(null);
      toast.success("Account deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const forceLogoutUserMutation = trpc.appUsers.forceLogoutUser.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`Session invalidated — @${rawUsers.find(u => u.id === vars.id)?.username ?? vars.id} will be logged out on next request.`);
    },
    onError: (e) => toast.error(e.message),
  });

  const disconnectDiscordMutation = trpc.appUsers.adminDisconnectDiscord.useMutation({
    onSuccess: (data) => {
      console.log(`[UserMgmt] ADMIN_DISCORD_DISCONNECT.SUCCESS: unlinked @${data.unlinkedDiscordUsername ?? data.unlinkedDiscordId}`);
      toast.success(`Discord account @${data.unlinkedDiscordUsername ?? data.unlinkedDiscordId} has been unlinked`);
      utils.appUsers.listUsers.invalidate();
    },
    onError: (err) => {
      console.error(`[UserMgmt] ADMIN_DISCORD_DISCONNECT.ERROR:`, err.message);
      toast.error(err.message);
    },
  });
  const forceLogoutAllMutation = trpc.appUsers.forceLogoutAll.useMutation({
    onSuccess: (data) => {
      toast.success(`Force logout complete — ${data.usersAffected} session(s) invalidated. Your session is unaffected.`);
    },
    onError: (e) => toast.error(e.message),
  });

  const [forceLogoutAllConfirm, setForceLogoutAllConfirm] = useState(false);

  // Redirect if not owner
  if (!loading && (!appUser || appUser.role !== "owner")) {
    navigate("/dashboard");
    return null;
  }

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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-zinc-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#0a0a0a] text-white flex flex-col">
      {/* Header — two-row on mobile, single-row on sm+ */}
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur border-b border-white/8 w-full">
        {/* Row 1: Back + Title */}
        <div className="w-full px-3 sm:px-5 lg:px-8 pt-3 pb-1.5 sm:pb-0 flex items-center gap-2">
          <button type="button" onClick={() => navigate("/dashboard")}
            className="flex items-center gap-1.5 text-zinc-200 hover:text-white transition-colors text-sm flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden xs:inline">Back</span>
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <Crown className="w-4 h-4 text-yellow-400 flex-shrink-0" />
            <span className="text-sm font-semibold tracking-wider text-white whitespace-nowrap">USER MANAGEMENT</span>
          </div>
          <div className="flex-1" />
          {/* Actions — hidden on mobile, shown inline on sm+ */}
          <div className="hidden sm:flex items-center gap-2">
            <Button
              onClick={() => setForceLogoutAllConfirm(true)}
              size="sm"
              variant="outline"
              className="gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/50"
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
              className="gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
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
            className="flex-1 gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/50 text-xs"
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
            className="flex-1 gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 text-xs"
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
            <div key={stat.label} className="bg-white/4 border border-white/8 rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0">
              <div className="text-lg sm:text-xl font-bold text-white truncate">{stat.value}</div>
              <div className="text-xs text-zinc-300 tracking-wide leading-tight mt-0.5 truncate">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* ── Metrics Panel ─────────────────────────────────────────────── */}
        <MetricsPanel />

        {/* Search bar */}
        <div className="mb-4 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by username or email…"
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-9 py-2 text-sm text-white placeholder:text-zinc-300 focus:outline-none focus:border-white/25 transition-colors"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-300 hover:text-zinc-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filtered count indicator */}
        {users.length !== rawUsers.length && (
          <div className="mb-3 flex items-center gap-2 text-xs text-zinc-200">
            <span>Showing <span className="text-white font-semibold">{users.length}</span> of <span className="text-white font-semibold">{rawUsers.length}</span> accounts</span>
            <button type="button" onClick={() => {
                setSearchQuery("");
                setCols({
                  username: defaultColState(), email: defaultColState(), role: defaultColState(),
                  access: defaultColState(), expiry: defaultColState(), terms: defaultColState(),
                  lastSignIn: defaultColState(),
                });
              }}
              className="text-red-400 hover:text-red-300 flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear all filters
            </button>
          </div>
        )}

        {/* Table */}
        <div className="bg-white/3 border border-white/8 rounded-xl overflow-hidden w-full">
          <div className="overflow-x-auto w-full">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent">
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
                <TableHead className="text-zinc-200 font-semibold tracking-wider text-xs">DISCORD STATUS</TableHead>
                <TableHead className="text-zinc-200 font-semibold tracking-wider text-xs">DISCORD USERNAME</TableHead>
                <TableHead className="text-zinc-200 font-semibold tracking-wider text-xs text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-zinc-300">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading accounts...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-zinc-300">
                    {rawUsers.length === 0 ? "No accounts yet. Create the first one." : "No accounts match the current filters."}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id} className="border-white/5 hover:bg-white/3">
                    <TableCell className="font-semibold text-white">@{user.username}</TableCell>
                    <TableCell className="text-zinc-200 text-sm">{user.email}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${ROLE_COLORS[user.role]}`}>
                        {ROLE_ICONS[user.role]}
                        {user.role.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${
                        user.hasAccess
                          ? "bg-green-500/15 text-green-400 border-green-500/30"
                          : "bg-red-500/15 text-red-400 border-red-500/30"
                      }`}>
                        {user.hasAccess ? "YES" : "NO"}
                      </span>
                    </TableCell>
                    <TableCell className="text-zinc-200 text-sm">{formatExpiry(user.expiryDate)}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${
                          user.termsAccepted
                            ? "bg-green-500/15 text-green-400 border-green-500/30"
                            : "bg-zinc-500/15 text-zinc-300 border-zinc-500/20"
                        }`}
                        title={user.termsAccepted && user.termsAcceptedAt ? `Accepted: ${new Date(user.termsAcceptedAt).toLocaleString()}` : "Not yet accepted"}
                      >
                        {user.termsAccepted ? "ACCEPTED" : "PENDING"}
                      </span>
                    </TableCell>
                    <TableCell className="text-zinc-200 text-sm">{formatDate(user.lastSignedIn)}</TableCell>
                    {/* DISCORD STATUS column */}
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${
                          user.discordId
                            ? "bg-[rgba(88,101,242,0.15)] text-[#7289da] border-[rgba(88,101,242,0.4)]"
                            : "bg-zinc-500/10 text-zinc-300 border-zinc-500/20"
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
                          "Not Connected"
                        )}
                      </span>
                    </TableCell>
                    {/* DISCORD USERNAME column */}
                    <TableCell className="text-sm">
                      {user.discordUsername ? (
                        <span className="text-[#7289da] font-medium">@{user.discordUsername}</span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => openEdit(user)}
                          className="p-1.5 rounded hover:bg-white/8 text-zinc-200 hover:text-white transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => forceLogoutUserMutation.mutate({ id: user.id })}
                          className="p-1.5 rounded hover:bg-orange-500/15 text-zinc-200 hover:text-orange-400 transition-colors"
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
                            className="p-1.5 rounded hover:bg-[rgba(88,101,242,0.2)] text-zinc-200 hover:text-[#7289da] transition-colors"
                            disabled={disconnectDiscordMutation.isPending}
                            title={`Unlink Discord @${user.discordUsername ?? user.discordId}`}
                          >
                            {/* Discord logo icon — signals this is a Discord-specific action */}
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.11 18.1.132 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                            </svg>
                          </button>
                        )}
                        <button type="button" onClick={() => setDeleteConfirm(user)}
                          className="p-1.5 rounded hover:bg-red-500/15 text-zinc-200 hover:text-red-400 transition-colors"
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
        <DialogContent className="bg-[#111] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="tracking-wider">
              {editUser ? "EDIT ACCOUNT" : "CREATE ACCOUNT"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-zinc-200 text-xs tracking-wider">EMAIL</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com"
                className="bg-white/5 border-white/10 text-white placeholder:text-zinc-300"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-200 text-xs tracking-wider">USERNAME</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300">@</span>
                <Input
                  value={form.username.replace(/^@/, "")}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder="username"
                  className="bg-white/5 border-white/10 text-white placeholder:text-zinc-300 pl-7"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-200 text-xs tracking-wider">
                {editUser ? "NEW PASSWORD (leave blank to keep current)" : "PASSWORD"}
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={editUser ? "••••••••" : "Min 8 characters"}
                  className="bg-white/5 border-white/10 text-white placeholder:text-zinc-300 pr-10"
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-300 hover:text-zinc-300 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-200 text-xs tracking-wider">ROLE</Label>
                <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as FormState["role"] }))}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a1a] border-white/10">
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="handicapper">Handicapper</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-200 text-xs tracking-wider">ACCESS</Label>
                <div className="flex items-center gap-2 h-10 px-3 bg-white/5 border border-white/10 rounded-md">
                  <Switch
                    checked={form.hasAccess}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, hasAccess: v }))}
                  />
                  <span className={`text-sm font-semibold ${form.hasAccess ? "text-green-400" : "text-red-400"}`}>
                    {form.hasAccess ? "Yes" : "No"}
                  </span>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-200 text-xs tracking-wider">EXPIRY DATE</Label>
              <Select value={form.expiryType} onValueChange={(v) => setForm((f) => ({ ...f, expiryType: v as "lifetime" | "custom" }))}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a1a] border-white/10">
                  <SelectItem value="lifetime">Lifetime Access</SelectItem>
                  <SelectItem value="custom">Custom Date</SelectItem>
                </SelectContent>
              </Select>
              {form.expiryType === "custom" && (
                <Input
                  type="datetime-local"
                  value={form.expiryDateStr}
                  onChange={(e) => setForm((f) => ({ ...f, expiryDateStr: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white mt-2"
                />
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setShowCreate(false); setEditUser(null); }}
              className="border-white/10 text-zinc-200 hover:text-white"
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
        <DialogContent className="bg-[#111] border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="tracking-wider text-orange-400 flex items-center gap-2">
              <LogOut className="w-4 h-4" />
              FORCE LOGOUT ALL
            </DialogTitle>
          </DialogHeader>
          <p className="text-zinc-200 text-sm py-2">
            This will immediately invalidate all active sessions for <span className="text-white font-semibold">every user except you</span>. They will be logged out on their next request.
          </p>
          <p className="text-zinc-300 text-xs">
            Your own session will not be affected. Users can log back in normally.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setForceLogoutAllConfirm(false)} className="border-white/10 text-zinc-200 hover:text-white">
              Cancel
            </Button>
            <Button
              className="bg-orange-600 hover:bg-orange-500 text-white"
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

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="bg-[#111] border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="tracking-wider text-red-400">DELETE ACCOUNT</DialogTitle>
          </DialogHeader>
          <p className="text-zinc-200 text-sm py-2">
            Are you sure you want to delete <span className="text-white font-semibold">@{deleteConfirm?.username}</span>? This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="border-white/10 text-zinc-200 hover:text-white">
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
    </div>
  );
}
