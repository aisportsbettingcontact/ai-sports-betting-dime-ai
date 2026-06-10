#!/usr/bin/env python3
"""
Fix the stuck "Syncing (background)" button by patching JackMacView.tsx.

Root cause: The polling useEffect only watches syncStatusQuery.data.
When getSyncStatus returns an error (NOT_FOUND after server restart),
data is undefined, the effect never fires, and isSyncPolling stays true forever.

Fix:
1. Add syncPollStartedAt and syncConsecutiveErrors state
2. Add clearSyncState helper (single source of truth for clearing all sync state)
3. Add safety-net useEffect: force-clear after 120s
4. Add error-watching useEffect: clear after 3 consecutive poll errors
5. Expand data-watching useEffect: handle 'not_found' sentinel + reset error counter
"""

filepath = "client/src/components/JackMacView.tsx"

with open(filepath, encoding="utf-8") as f:
    content = f.read()

# ─── Locate the block by line numbers (522-596) ───────────────────────────────
lines = content.split("\n")

# Find start: line containing "Google Sheets Sync" comment
start_line = None
for i, line in enumerate(lines):
    if "Google Sheets Sync" in line and "background job pattern" in line:
        start_line = i
        break

if start_line is None:
    print("ERROR: Could not find 'Google Sheets Sync — background job pattern' comment")
    exit(1)

print(f"Found start at line {start_line + 1}: {lines[start_line][:80]!r}")

# Find end: the closing ], [syncStatusQuery.data, isSyncPolling]); line
end_line = None
for i in range(start_line, min(start_line + 200, len(lines))):
    if "syncStatusQuery.data, isSyncPolling" in lines[i] and "]);" in lines[i]:
        end_line = i
        break

if end_line is None:
    print("ERROR: Could not find end of polling useEffect")
    exit(1)

print(f"Found end at line {end_line + 1}: {lines[end_line][:80]!r}")
print(
    f"Replacing lines {start_line + 1} to {end_line + 1} ({end_line - start_line + 1} lines)"
)

# ─── New block ────────────────────────────────────────────────────────────────
new_block = """  // \u2500\u2500 Google Sheets Sync \u2014 background job pattern \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // syncToSheets.mutate() returns { jobId, runId } immediately (< 50ms)
  // OR { locked: true, existingRunId } if a run is already in progress.
  // We then poll getSyncStatus every 2s until the job completes.
  //
  // STUCK STATE PREVENTION:
  //   - Safety net: force-clear after 120s regardless of server state
  //   - Error handler: clear after 3 consecutive poll errors (server restart, network)
  //   - not_found sentinel: server returns { status: 'not_found' } instead of throwing
  //     when the job is missing (e.g., after server restart). We clear immediately.
  const [syncJobId, setSyncJobId] = useState<string | null>(null);
  const [isSyncPolling, setIsSyncPolling] = useState(false);
  const [syncLockedRunId, setSyncLockedRunId] = useState<string | null>(null);
  const [syncPollStartedAt, setSyncPollStartedAt] = useState<number | null>(null);
  const [syncConsecutiveErrors, setSyncConsecutiveErrors] = useState(0);

  // Single source of truth for clearing all sync polling state
  const clearSyncState = useCallback((
    reason: string,
    showToast?: { type: "success" | "warning" | "error"; msg: string }
  ) => {
    console.log(`[JACKMAC][SHEETS][STATE] clearSyncState reason="${reason}"`);
    setIsSyncPolling(false);
    setSyncJobId(null);
    setSyncPollStartedAt(null);
    setSyncConsecutiveErrors(0);
    if (showToast?.type === "success") toast.success(showToast.msg, { duration: 6000 });
    else if (showToast?.type === "warning") toast.warning(showToast.msg, { duration: 8000 });
    else if (showToast?.type === "error") toast.error(showToast.msg, { duration: 8000 });
  }, []);

  const syncStatusQuery = trpc.jackMac.getSyncStatus.useQuery(
    { jobId: syncJobId! },
    {
      enabled: isSyncPolling && syncJobId !== null,
      refetchInterval: isSyncPolling ? 2000 : false,
      retry: false,
    }
  );

  // Poll run lock state when we know a lock is held (but we don't have the jobId)
  const runLockQuery = trpc.jackMac.getRunLockState.useQuery(undefined, {
    enabled: isAllowed && syncLockedRunId !== null,
    refetchInterval: syncLockedRunId !== null ? 3000 : false,
    retry: false,
  });

  // Watch runLockQuery \u2014 clear locked state when lock is released
  useEffect(() => {
    if (!runLockQuery.data) return;
    if (!runLockQuery.data.isLocked && syncLockedRunId !== null) {
      console.log(`[JACKMAC][SHEETS][STATE] Run lock released \u2014 clearing locked state`);
      setSyncLockedRunId(null);
      toast.info("Google Sheets sync completed by another process.", { duration: 4000 });
    }
  }, [runLockQuery.data, syncLockedRunId]);

  // Safety net: force-clear stuck polling after 120s regardless of server state
  // Prevents permanent stuck state if the server restarts mid-sync
  useEffect(() => {
    if (!isSyncPolling || syncPollStartedAt === null) return;
    const MAX_POLL_MS = 120_000;
    const elapsed = Date.now() - syncPollStartedAt;
    const remaining = MAX_POLL_MS - elapsed;
    if (remaining <= 0) {
      console.warn(`[JACKMAC][SHEETS][VERIFY] TIMEOUT \u2014 polling exceeded ${MAX_POLL_MS / 1000}s, force-clearing stuck state`);
      clearSyncState("safety-timeout", {
        type: "warning",
        msg: "Sync status unknown \u2014 the server may have restarted. Check Google Sheets directly.",
      });
      return;
    }
    const timer = setTimeout(() => {
      console.warn(`[JACKMAC][SHEETS][VERIFY] TIMEOUT \u2014 polling exceeded ${MAX_POLL_MS / 1000}s, force-clearing stuck state`);
      clearSyncState("safety-timeout", {
        type: "warning",
        msg: "Sync status unknown \u2014 the server may have restarted. Check Google Sheets directly.",
      });
    }, remaining);
    return () => clearTimeout(timer);
  }, [isSyncPolling, syncPollStartedAt, clearSyncState]);

  // Watch syncStatusQuery.error \u2014 handle NOT_FOUND and network errors gracefully
  // After 3 consecutive errors, force-clear the stuck state
  useEffect(() => {
    if (!isSyncPolling || !syncStatusQuery.error) return;
    const errMsg = (syncStatusQuery.error as { message?: string })?.message ?? "Unknown poll error";
    const newCount = syncConsecutiveErrors + 1;
    setSyncConsecutiveErrors(newCount);
    console.warn(`[JACKMAC][SHEETS][VERIFY] Poll error #${newCount}: ${errMsg}`);
    if (newCount >= 3) {
      console.error(
        `[JACKMAC][SHEETS][VERIFY] FAIL \u2014 ${newCount} consecutive poll errors, force-clearing. Last: ${errMsg}`
      );
      clearSyncState("consecutive-poll-errors", {
        type: "warning",
        msg: `Sync status lost after ${newCount} poll errors \u2014 the server may have restarted. Check Google Sheets directly.`,
      });
    }
  }, [syncStatusQuery.error, isSyncPolling, syncConsecutiveErrors, clearSyncState]);

  // Watch syncStatusQuery.data \u2014 handle all terminal statuses including not_found
  useEffect(() => {
    if (!isSyncPolling || !syncStatusQuery.data) return;
    // Reset consecutive error counter on any successful poll response
    if (syncConsecutiveErrors > 0) setSyncConsecutiveErrors(0);
    const job = syncStatusQuery.data;

    // Handle not_found sentinel: server returned { status: 'not_found' }
    // This happens when the server restarted and the in-memory syncJobStore was cleared
    if ((job.status as string) === "not_found") {
      console.warn(
        `[JACKMAC][SHEETS][VERIFY] WARN \u2014 jobId=${syncJobId} not found on server (server may have restarted)`
      );
      clearSyncState("job-not-found", {
        type: "warning",
        msg: "Sync job not found \u2014 the server may have restarted. The sync likely completed. Check Google Sheets directly.",
      });
      return;
    }

    if (job.status === "success" || job.status === "error") {
      if (job.status === "success" && job.result) {
        const result = job.result as SheetSyncResult;
        if (result.success) {
          const failedTabs = result.tabs.filter(t => t.status === "error");
          const readBackFailed = result.tabs.filter(t => !t.readBackValidated && t.rowsWritten > 0);
          if (failedTabs.length === 0 && readBackFailed.length === 0) {
            clearSyncState("job-success", {
              type: "success",
              msg: `Google Sheets synced! ${result.totalRowsWritten.toLocaleString()} rows across ${result.tabs.length} tabs in ${(result.elapsedMs / 1000).toFixed(1)}s`,
            });
          } else {
            const warnings: string[] = [];
            if (failedTabs.length > 0) warnings.push(`${failedTabs.length} tabs failed`);
            if (readBackFailed.length > 0) warnings.push(`${readBackFailed.length} read-back mismatches`);
            clearSyncState("job-partial", { type: "warning", msg: `Partial sync \u2014 ${warnings.join(", ")}` });
          }
          console.log(
            `[JACKMAC][SHEETS][OUTPUT] Sync success: runId=${result.runId} totalRows=${result.totalRowsWritten} elapsed=${result.elapsedMs}ms`
          );
          for (const tab of result.tabs) {
            console.log(
              `[JACKMAC][SHEETS][STATE] [${tab.status.toUpperCase()}] "${tab.sheetTab}" \u2192 ${tab.rowsWritten} rows readBack=${tab.readBackRowCount} validated=${tab.readBackValidated} rollback=${tab.rollbackAttempted} (${tab.elapsedMs}ms)`
            );
          }
        } else {
          const failedTabs = result.tabs.filter(t => t.status === "error").map(t => t.sheetTab).join(", ");
          clearSyncState("job-partial-fail", { type: "warning", msg: `Partial sync \u2014 some tabs failed: ${failedTabs}` });
          console.warn(`[JACKMAC][SHEETS][VERIFY] PARTIAL \u2014 failed tabs: ${failedTabs}`);
        }
      } else if (job.status === "error") {
        clearSyncState("job-error", { type: "error", msg: `Google Sheets sync failed: ${job.error ?? "Unknown error"}` });
        console.error(`[JACKMAC][SHEETS][VERIFY] FAIL \u2014 ${job.error}`);
      }
    }
  }, [syncStatusQuery.data, isSyncPolling, syncConsecutiveErrors, syncJobId, clearSyncState]);"""

# Replace lines start_line to end_line (inclusive) with new_block
new_lines = lines[:start_line] + new_block.split("\n") + lines[end_line + 1 :]
new_content = "\n".join(new_lines)

with open(filepath, "w", encoding="utf-8") as f:
    f.write(new_content)

print(
    f"SUCCESS: Replaced {end_line - start_line + 1} lines with {len(new_block.split(chr(10)))} lines"
)
print(f"File size: {len(new_content)} bytes")
