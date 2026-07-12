/**
 * Bounded ring buffer over records carrying monotonically increasing sequence
 * numbers (assigned by the session's shared counter), with cursor-based delta
 * queries.
 */
export class EventRing<T extends { seq: number }> {
  private items: T[] = [];
  private lastSeq = 0;
  private droppedCount = 0;

  constructor(private readonly maxEntries: number) {}

  push(record: T): T {
    this.lastSeq = Math.max(this.lastSeq, record.seq);
    this.items.push(record);
    if (this.items.length > this.maxEntries) {
      this.items.splice(0, this.items.length - this.maxEntries);
      this.droppedCount++;
    }
    return record;
  }

  /** Latest sequence number seen by this ring (0 when empty). */
  get cursor(): number {
    return this.lastSeq;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  get size(): number {
    return this.items.length;
  }

  /**
   * Delta query: records with seq > since, oldest first, up to limit.
   * `truncated` is true when more matching records exist beyond limit
   * (or older matching records were evicted from the ring).
   */
  query(
    since: number,
    limit: number,
    filter?: (item: T) => boolean,
  ): { items: T[]; cursor: number; truncated: boolean; totalMatched: number } {
    const oldestKept = this.items.length > 0 ? this.items[0]!.seq : this.lastSeq + 1;
    const evicted = this.droppedCount > 0 && since + 1 < oldestKept && since < this.lastSeq;
    const matched = this.items.filter((i) => i.seq > since && (!filter || filter(i)));
    const items = matched.slice(0, limit);
    const cursor = items.length > 0 ? items[items.length - 1]!.seq : this.lastSeq;
    return {
      items,
      cursor,
      truncated: evicted || matched.length > items.length,
      totalMatched: matched.length,
    };
  }

  /** All current items (bounded by maxEntries by construction). */
  snapshot(): readonly T[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
  }
}
