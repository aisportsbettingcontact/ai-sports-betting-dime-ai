/**
 * Mobile Owner Tabs — Logging System
 * ═══════════════════════════════════
 * Industry-leading event logging with full metadata capture.
 * All events are buffered in-memory and can be exported via debug panel.
 */

import type { MobileOwnerTabEvent, MobileOwnerTabId, MobileOwnerTabLogEntry } from "./config";

const MAX_LOG_ENTRIES = 500;
const LOG_PREFIX = "[MobileOwnerTabs]";

class MobileOwnerTabLogger {
  private entries: MobileOwnerTabLogEntry[] = [];
  private sessionId: string;
  private startTime: number;

  constructor() {
    this.sessionId = this.generateSessionId();
    this.startTime = Date.now();
  }

  private generateSessionId(): string {
    return `mot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  log(event: MobileOwnerTabEvent, tabId?: MobileOwnerTabId, metadata?: Record<string, unknown>): void {
    const entry: MobileOwnerTabLogEntry = {
      timestamp: Date.now(),
      event,
      tabId,
      metadata,
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries = this.entries.slice(-MAX_LOG_ENTRIES);
    }

    // Console output with structured format
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const tabStr = tabId ? ` [${tabId}]` : "";
    const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : "";
    console.log(`${LOG_PREFIX} [${elapsed}s]${tabStr} ${event}${metaStr}`);
  }

  getEntries(): MobileOwnerTabLogEntry[] {
    return [...this.entries];
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionDuration(): number {
    return Date.now() - this.startTime;
  }

  getEventCount(event?: MobileOwnerTabEvent): number {
    if (!event) return this.entries.length;
    return this.entries.filter(e => e.event === event).length;
  }

  getLastEvent(): MobileOwnerTabLogEntry | null {
    return this.entries[this.entries.length - 1] ?? null;
  }

  exportJSON(): string {
    return JSON.stringify({
      sessionId: this.sessionId,
      startTime: this.startTime,
      duration: this.getSessionDuration(),
      totalEvents: this.entries.length,
      entries: this.entries,
    }, null, 2);
  }

  clear(): void {
    this.entries = [];
    this.sessionId = this.generateSessionId();
    this.startTime = Date.now();
  }
}

// Singleton instance
export const mobileOwnerTabLogger = new MobileOwnerTabLogger();
