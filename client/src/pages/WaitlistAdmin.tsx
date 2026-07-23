/**
 * WaitlistAdmin.tsx
 *
 * Owner-only admin page for managing the pre-launch waitlist.
 *
 * Features:
 *   - Full paginated table of waitlist entries
 *   - Filter by status (all / pending / approved / denied)
 *   - Search by email, first name, or last name
 *   - Per-row status actions: Approve, Deny, Reset to Pending
 *   - Bulk status update for selected rows
 *   - Contact modal: compose a message to a specific applicant (opens mailto)
 *   - Stats bar: total, pending, approved, denied counts
 *   - CSV export (downloads all entries as a CSV file)
 *   - Owner-only access guard — redirects to / if not owner
 *
 * Logging:
 *   All user actions are logged to the browser console with structured prefixes:
 *   [WaitlistAdmin][ACTION] — user-initiated actions
 *   [WaitlistAdmin][STATE]  — component state transitions
 *   [WaitlistAdmin][ERROR]  — error conditions
 */

import { useEffect, useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { AdminShell } from "@/pages/admin/AdminShell";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
type WaitlistStatus = "pending" | "approved" | "denied";

interface WaitlistEntry {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: WaitlistStatus;
  adminNote: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  ipAddress: string | null;
  createdAt: number;
  updatedAt: number;
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: WaitlistStatus }) {
  const styles: Record<WaitlistStatus, { bg: string; text: string; label: string }> = {
    pending:  { bg: "bg-transparent",  text: "text-white",  label: "Pending" },
    approved: { bg: "bg-transparent", text: "text-[#45E0A8]", label: "Approved" },
    denied:   { bg: "bg-transparent",    text: "text-white",    label: "Denied" },
  };
  const s = styles[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4 rounded-xl bg-black border border-white">
      <span className={`text-2xl font-black ${color}`}>{value.toLocaleString()}</span>
      <span className="text-xs text-white uppercase tracking-widest font-medium">{label}</span>
    </div>
  );
}

// ─── Contact modal ────────────────────────────────────────────────────────────
function ContactModal({
  entry,
  onClose,
}: {
  entry: WaitlistEntry;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState("Your Waitlist Application — AI Sports Betting");
  const [body, setBody] = useState(
    `Hi ${entry.firstName ?? "there"},\n\nThank you for joining our waitlist.\n\n`
  );

  const displayName = [entry.firstName, entry.lastName].filter(Boolean).join(" ") || entry.email;

  function handleSend() {
    const mailtoUrl = `mailto:${entry.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    console.log(`[WaitlistAdmin][ACTION] Opening mailto for id=${entry.id} email=${entry.email}`);
    window.open(mailtoUrl, "_blank");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "#000000", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-black border border-white rounded-2xl p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Contact Applicant</h3>
            <p className="text-xs text-white mt-0.5">{displayName} · {entry.email}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Subject */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-white uppercase tracking-wider">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-black border border-white text-sm text-white placeholder-white outline-none focus:border-[#45E0A8] transition-colors"
          />
        </div>

        {/* Body */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-white uppercase tracking-wider">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            className="w-full px-3 py-2.5 rounded-lg bg-black border border-white text-sm text-white placeholder-white outline-none focus:border-[#45E0A8] transition-colors resize-none"
          />
        </div>

        {/* Note */}
        <p className="text-xs text-white">
          This will open your default email client with the message pre-filled.
        </p>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            className="px-5 py-2 rounded-lg text-sm font-bold text-black bg-[#45E0A8] transition-colors"
          >
            Open in Email Client →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function WaitlistAdmin() {
  const [, navigate] = useLocation();
  const { appUser, loading: authLoading, isOwner } = useAppAuth();
  // toast imported from sonner at top

  // ── Filter / search state ──────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<WaitlistStatus | "all">("all");
  const [searchQuery, setSearchQuery]   = useState("");
  const [page, setPage]                 = useState(1);
  const PAGE_SIZE = 50;

  // ── Selection state ─────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // ── Optimistic delete state ──────────────────────────────────────────
  // IDs that have been optimistically removed from the UI before the server confirms
  const [optimisticDeletedIds, setOptimisticDeletedIds] = useState<Set<number>>(new Set());

  // ── Contact modal state ──────────────────────────────────────────
  const [contactEntry, setContactEntry] = useState<WaitlistEntry | null>(null);

  // ── Auth guard — MUST be useEffect, never conditional render before hooks ──
  useEffect(() => {
    if (!authLoading && (!appUser || !isOwner)) {
      console.warn(
        `[WaitlistAdmin][STATE] Unauthorized access attempt: user=${appUser?.username ?? "unauthenticated"} isOwner=${isOwner} → redirecting to /`
      );
      navigate("/");
    }
  }, [authLoading, appUser, isOwner, navigate]);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const listQuery = trpc.waitlist.list.useQuery(
    {
      status: statusFilter === "all" ? undefined : statusFilter,
      search: searchQuery.trim() || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    {
      enabled: !authLoading && !!appUser && isOwner,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    }
  );

  const statsQuery = trpc.waitlist.stats.useQuery(undefined, {
    enabled: !authLoading && !!appUser && isOwner,
    staleTime: 15_000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const utils = trpc.useUtils();

  function invalidate() {
    utils.waitlist.list.invalidate();
    utils.waitlist.stats.invalidate();
  }

  const updateStatusMutation = trpc.waitlist.updateStatus.useMutation({
    onSuccess: (_, vars) => {
      console.log(`[WaitlistAdmin][ACTION] updateStatus id=${vars.id} → ${vars.status} ✓`);
      toast.success("Status updated", { description: `Entry #${vars.id} → ${vars.status}` });
      invalidate();
    },
    onError: (err, vars) => {
      console.error(`[WaitlistAdmin][ERROR] updateStatus id=${vars.id} failed: ${err.message}`);
      toast.error("Update failed", { description: err.message });
    },
  });

  const bulkUpdateMutation = trpc.waitlist.bulkUpdate.useMutation({
    onSuccess: (data) => {
      console.log(`[WaitlistAdmin][ACTION] bulkUpdate → ${data.updated} rows updated ✓`);
      toast.success("Bulk update complete", { description: `${data.updated} entries updated` });
      setSelectedIds(new Set());
      invalidate();
    },
    onError: (err) => {
      console.error(`[WaitlistAdmin][ERROR] bulkUpdate failed: ${err.message}`);
      toast.error("Bulk update failed", { description: err.message });
    },
  });

  const deleteMutation = trpc.waitlist.delete.useMutation({
    onSuccess: (_, vars) => {
      console.log(`[WaitlistAdmin][ACTION] delete id=${vars.id} ✓ (server confirmed)`);
      toast.success("Entry deleted");
      // Clean up selection state
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(vars.id); return n; });
      // Optimistic ID can now be cleared (row is gone from server too)
      setOptimisticDeletedIds((prev) => { const n = new Set(prev); n.delete(vars.id); return n; });
      invalidate();
    },
    onError: (err, vars) => {
      console.error(`[WaitlistAdmin][ERROR] delete id=${vars.id} failed: ${err.message}`);
      // Rollback: restore the row by removing it from optimistic-deleted set
      setOptimisticDeletedIds((prev) => { const n = new Set(prev); n.delete(vars.id); return n; });
      toast.error("Delete failed — entry restored", { description: err.message });
    },
  });

  const exportQuery = trpc.waitlist.exportCsv.useQuery(
    { status: statusFilter === "all" ? "all" : statusFilter },
    { enabled: false, staleTime: 0 }
  );

  async function handleExportCsv() {
    console.log(`[WaitlistAdmin][ACTION] exportCsv triggered status=${statusFilter}`);
    try {
      const result = await exportQuery.refetch();
      const data = result.data;
      if (!data) return;
      const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href     = url;
      link.download = `waitlist-export-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      const rowCount = data.csv.split("\n").length - 1;
      console.log(`[WaitlistAdmin][ACTION] exportCsv → ${rowCount} rows ✓`);
      toast.success("CSV exported", { description: `${rowCount} rows` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WaitlistAdmin][ERROR] exportCsv failed: ${msg}`);
      toast.error("Export failed", { description: msg });
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  // Filter out optimistically-deleted rows so they disappear immediately on click
  const entries: WaitlistEntry[] = useMemo(
    () => ((listQuery.data?.rows ?? []) as unknown as WaitlistEntry[]).filter(
      (e) => !optimisticDeletedIds.has(e.id)
    ),
    [listQuery.data, optimisticDeletedIds]
  );
  const totalCount = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const stats = statsQuery.data ?? { total: 0, pending: 0, approved: 0, denied: 0 };

  const allPageSelected = entries.length > 0 && entries.every((e) => selectedIds.has(e.id));
  const somePageSelected = entries.some((e) => selectedIds.has(e.id));

  // Reset page when filter/search changes
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [statusFilter, searchQuery]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleSelectAll() {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        entries.forEach((e) => n.delete(e.id));
        return n;
      });
    } else {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        entries.forEach((e) => n.add(e.id));
        return n;
      });
    }
  }

  function handleToggleRow(id: number) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function handleBulkUpdate(status: WaitlistStatus) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    console.log(`[WaitlistAdmin][ACTION] bulkUpdate ids=[${ids.join(",")}] → ${status}`);
    bulkUpdateMutation.mutate({ ids, status });
  }

  function handleDelete(id: number, email: string) {
    if (!window.confirm(`Permanently delete ${email}? This cannot be undone.`)) return;
    console.log(`[WaitlistAdmin][ACTION] delete id=${id} email=${email} — optimistically removing from UI`);
    // Optimistically hide the row immediately
    setOptimisticDeletedIds((prev) => { const n = new Set(prev); n.add(id); return n; });
    deleteMutation.mutate({ id });
  }

  // handleExportCsv is defined above with the exportQuery

  function formatDate(d: Date | string | number) {
    return new Date(d).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  }

  // ── Loading / auth skeleton ────────────────────────────────────────────────
  if (authLoading || (!authLoading && (!appUser || !isOwner))) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-white border-t-[#45E0A8] rounded-full animate-spin" />
        <span className="text-white text-sm">
          {authLoading ? "Verifying access..." : "Redirecting..."}
        </span>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AdminShell active="waitlist">
      {/* Self-contained dark surface so the page's hardcoded white text stays
          readable inside the theme-aware AdminShell chrome (token migration TODO). */}
      <div className="min-h-[calc(100vh-3.5rem)] bg-black text-white">
      {/* Contact modal */}
      {contactEntry && (
        <ContactModal entry={contactEntry} onClose={() => setContactEntry(null)} />
      )}

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-[#45E0A8] animate-pulse" />
              <span className="text-xs font-semibold text-[#45E0A8] uppercase tracking-widest">
                Owner Access Only
              </span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">Waitlist Management</h1>
            <p className="text-sm text-white mt-1">
              Review, approve, deny, and contact pre-launch applicants.
            </p>
          </div>
          <button
            onClick={handleExportCsv}
            disabled={exportQuery.isFetching}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-black border border-white text-white transition-colors disabled:opacity-50"
          >
            {exportQuery.isFetching ? (
              <span className="w-4 h-4 border-2 border-white border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            Export CSV
          </button>
        </div>

        {/* ── Stats bar ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total"    value={stats.total}    color="text-white" />
          <StatCard label="Pending"  value={stats.pending}  color="text-white" />
          <StatCard label="Approved" value={stats.approved} color="text-[#45E0A8]" />
          <StatCard label="Denied"   value={stats.denied}   color="text-white" />
        </div>

        {/* ── Filters row ─────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by email or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-black border border-white text-sm text-white placeholder-white outline-none focus:border-[#45E0A8] transition-colors"
            />
          </div>

          {/* Status filter tabs */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-black border border-white">
            {(["all", "pending", "approved", "denied"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${
                  statusFilter === s
                    ? "bg-[#45E0A8] text-black"
                    : "text-white hover:text-white"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ── Bulk action bar (shows when rows are selected) ───────────────── */}
        {somePageSelected && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-transparent border border-white">
            <span className="text-sm font-semibold text-white">
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => handleBulkUpdate("approved")}
                disabled={bulkUpdateMutation.isPending}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-[#45E0A8] bg-transparent border border-[#45E0A8] transition-colors disabled:opacity-50"
              >
                Approve All
              </button>
              <button
                onClick={() => handleBulkUpdate("denied")}
                disabled={bulkUpdateMutation.isPending}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-transparent border border-white transition-colors disabled:opacity-50"
              >
                Deny All
              </button>
              <button
                onClick={() => handleBulkUpdate("pending")}
                disabled={bulkUpdateMutation.isPending}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-transparent border border-white transition-colors disabled:opacity-50"
              >
                Reset to Pending
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:text-white transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* ── Table ───────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-white overflow-hidden">
          {/* Loading overlay */}
          {listQuery.isFetching && (
            <div className="px-4 py-2 bg-transparent border-b border-white text-xs text-[#45E0A8] flex items-center gap-2">
              <span className="w-3 h-3 border border-[#45E0A8] border-t-transparent rounded-full animate-spin" />
              Refreshing...
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white bg-black">
                  {/* Select all */}
                  <th className="w-10 px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={handleSelectAll}
                      className="w-4 h-4 rounded border-white bg-black accent-[#45E0A8] cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">Joined</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-white uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white">
                {listQuery.isLoading ? (
                  /* Loading skeleton rows */
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="bg-black">
                      <td className="px-4 py-3"><div className="w-4 h-4 rounded bg-black animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-48 rounded bg-black animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-28 rounded bg-black animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-5 w-16 rounded-full bg-black animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 rounded bg-black animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-32 rounded bg-black animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-black animate-pulse ml-auto" /></td>
                    </tr>
                  ))
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-white">
                      <div className="flex flex-col items-center gap-3">
                        <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                        </svg>
                        <span className="text-sm">
                          {searchQuery || statusFilter !== "all"
                            ? "No entries match your filters."
                            : "No waitlist entries yet. Share the landing page to start collecting signups."}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => {
                    const isSelected = selectedIds.has(entry.id);
                    const displayName = [entry.firstName, entry.lastName].filter(Boolean).join(" ");
                    const utmDisplay = [entry.utmSource, entry.utmMedium, entry.utmCampaign]
                      .filter(Boolean).join(" / ") || "—";

                    return (
                      <tr
                        key={entry.id}
                        className={`transition-colors ${
                          isSelected ? "bg-transparent" : "bg-black"
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleRow(entry.id)}
                            className="w-4 h-4 rounded border-white bg-black accent-[#45E0A8] cursor-pointer"
                          />
                        </td>

                        {/* Email */}
                        <td className="px-4 py-3">
                          <span className="font-medium text-white">{entry.email}</span>
                        </td>

                        {/* Name */}
                        <td className="px-4 py-3 text-white">
                          {displayName || <span className="text-white italic">—</span>}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <StatusBadge status={entry.status} />
                        </td>

                        {/* UTM source */}
                        <td className="px-4 py-3 text-white text-xs max-w-[140px] truncate" title={utmDisplay}>
                          {utmDisplay}
                        </td>

                        {/* Joined date */}
                        <td className="px-4 py-3 text-white text-xs whitespace-nowrap">
                          {formatDate(entry.createdAt)}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Approve */}
                            {entry.status !== "approved" && (
                              <button
                                onClick={() => updateStatusMutation.mutate({ id: entry.id, status: "approved" })}
                                disabled={updateStatusMutation.isPending}
                                title="Approve"
                                className="px-2.5 py-1 rounded-md text-xs font-semibold text-[#45E0A8] bg-transparent border border-[#45E0A8] transition-colors disabled:opacity-50"
                              >
                                Approve
                              </button>
                            )}
                            {/* Deny */}
                            {entry.status !== "denied" && (
                              <button
                                onClick={() => updateStatusMutation.mutate({ id: entry.id, status: "denied" })}
                                disabled={updateStatusMutation.isPending}
                                title="Deny"
                                className="px-2.5 py-1 rounded-md text-xs font-semibold text-white bg-transparent border border-white transition-colors disabled:opacity-50"
                              >
                                Deny
                              </button>
                            )}
                            {/* Reset to pending */}
                            {entry.status !== "pending" && (
                              <button
                                onClick={() => updateStatusMutation.mutate({ id: entry.id, status: "pending" })}
                                disabled={updateStatusMutation.isPending}
                                title="Reset to Pending"
                                className="px-2.5 py-1 rounded-md text-xs font-semibold text-white bg-transparent border border-white transition-colors disabled:opacity-50"
                              >
                                Pending
                              </button>
                            )}
                            {/* Contact */}
                            <button
                              onClick={() => {
                                console.log(`[WaitlistAdmin][ACTION] openContact id=${entry.id} email=${entry.email}`);
                                setContactEntry(entry);
                              }}
                              title="Contact"
                              className="p-1.5 rounded-md text-white hover:text-[#45E0A8] transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            </button>
                            {/* Delete */}
                            <button
                              onClick={() => handleDelete(entry.id, entry.email)}
                              disabled={deleteMutation.isPending}
                              title="Delete permanently"
                              className="p-1.5 rounded-md text-white hover:text-white transition-colors disabled:opacity-50"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Pagination ──────────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-white">
              Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()} entries
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg bg-black border border-white text-white hover:text-white hover:border-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs font-medium"
              >
                ← Prev
              </button>
              <span className="text-white text-xs">
                Page {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg bg-black border border-white text-white hover:text-white hover:border-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs font-medium"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Error state ─────────────────────────────────────────────────── */}
        {listQuery.isError && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-transparent border border-white text-sm text-white">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            Failed to load waitlist: {listQuery.error.message}
            <button
              onClick={() => listQuery.refetch()}
              className="ml-auto text-xs font-semibold underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}
      </div>
      </div>
    </AdminShell>
  );
}
