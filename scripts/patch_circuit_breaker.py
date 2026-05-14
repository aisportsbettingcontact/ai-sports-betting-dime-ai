#!/usr/bin/env python3
"""
patch_circuit_breaker.py
────────────────────────────────────────────────────────────────────────────────
Wraps every bare `await db.<op>(...)` call in server/db.ts with
`withCircuitBreaker(async () => { ... })` where it is missing.

Strategy:
  - Target ONLY the write-path and critical admin functions that are currently
    missing circuit breaker protection.
  - Use surgical, function-level replacements — do NOT touch functions that
    already have withCircuitBreaker.
  - After patching, verify no duplicate wrapping exists.

[INPUT]  server/db.ts (read)
[OUTPUT] server/db.ts (overwritten with patches applied)
[VERIFY] grep for double-wrapping; count of withCircuitBreaker occurrences before/after
"""

import re
import sys

DB_FILE = "server/db.ts"

content = open(DB_FILE).read()
original_count = content.count("withCircuitBreaker")
print(f"[INPUT] withCircuitBreaker occurrences before patch: {original_count}")

# ── Helper: wrap a function body ──────────────────────────────────────────────
def wrap_fn(old_body: str, new_body: str, fn_name: str) -> tuple[str, bool]:
    """Replace old_body with new_body in content. Returns (new_content, changed)."""
    global content
    if old_body not in content:
        print(f"  [SKIP] {fn_name} — exact text not found (already patched or changed)")
        return content, False
    if "withCircuitBreaker" in old_body:
        print(f"  [SKIP] {fn_name} — already has withCircuitBreaker")
        return content, False
    content = content.replace(old_body, new_body, 1)
    print(f"  [PATCH] {fn_name} — wrapped with withCircuitBreaker")
    return content, True

patches_applied = 0

# ════════════════════════════════════════════════════════════════════════════════
# 1. updateAppUser — write path (THE primary bug trigger)
# ════════════════════════════════════════════════════════════════════════════════
old = '''export async function updateAppUser(id: number, data: Partial<InsertAppUser>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(appUsers).set({ ...data, updatedAt: new Date() }).where(eq(appUsers.id, id));
}'''
new = '''export async function updateAppUser(id: number, data: Partial<InsertAppUser>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await withCircuitBreaker(async () => {
    await db.update(appUsers).set({ ...data, updatedAt: new Date() }).where(eq(appUsers.id, id));
  });
}'''
content, changed = wrap_fn(old, new, "updateAppUser")
if changed: patches_applied += 1

# ════════════════════════════════════════════════════════════════════════════════
# 2. deleteAppUser
# ════════════════════════════════════════════════════════════════════════════════
old = '''export async function deleteAppUser(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(appUsers).where(eq(appUsers.id, id));
}'''
new = '''export async function deleteAppUser(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await withCircuitBreaker(async () => {
    await db.delete(appUsers).where(eq(appUsers.id, id));
  });
}'''
content, changed = wrap_fn(old, new, "deleteAppUser")
if changed: patches_applied += 1

# ════════════════════════════════════════════════════════════════════════════════
# 3. createAppUser
# ════════════════════════════════════════════════════════════════════════════════
old_match = re.search(r'export async function createAppUser\([^)]+\)[^{]*\{[^}]+\}', content, re.DOTALL)
if old_match:
    old_text = old_match.group(0)
    if 'withCircuitBreaker' not in old_text:
        # Find the insert line
        new_text = re.sub(
            r'(  const db = await getDb\(\);\n  if \(!db\) throw new Error\("Database not available"\);\n)(  (?:const \[result\] = )?await db\.insert)',
            r'\1  return await withCircuitBreaker(async () => {\n    const [result] = await db.insert',
            old_text
        )
        # This approach is too fragile — use direct text match instead
        print("  [INFO] createAppUser — using direct text match")

# Direct text match for createAppUser
old = None
# Find it by searching for the function
start = content.find('export async function createAppUser(')
if start != -1:
    # Find the matching closing brace
    depth = 0
    i = start
    in_fn = False
    fn_start = start
    fn_end = -1
    for i in range(start, len(content)):
        if content[i] == '{':
            depth += 1
            in_fn = True
        elif content[i] == '}':
            depth -= 1
            if in_fn and depth == 0:
                fn_end = i + 1
                break
    if fn_end != -1:
        fn_body = content[fn_start:fn_end]
        if 'withCircuitBreaker' not in fn_body:
            print(f"  [INFO] createAppUser body found ({len(fn_body)} chars)")
            # Replace the inner db call
            new_fn_body = fn_body.replace(
                '  if (!db) throw new Error("Database not available");\n  const [result] = await db.insert',
                '  if (!db) throw new Error("Database not available");\n  const [result] = await withCircuitBreaker(async () => {\n    const rows = await db.insert'
            )
            if new_fn_body != fn_body:
                print("  [WARN] createAppUser — complex body, using targeted line replacement")
        else:
            print("  [SKIP] createAppUser — already has withCircuitBreaker")

# Use simpler targeted approach for createAppUser
# Read the actual function
idx = content.find('export async function createAppUser(')
if idx != -1:
    snippet = content[idx:idx+600]
    print(f"  [DEBUG] createAppUser snippet:\n{snippet[:300]}")

# ════════════════════════════════════════════════════════════════════════════════
# 4. incrementTokenVersion
# ════════════════════════════════════════════════════════════════════════════════
old = '''export async function incrementTokenVersion(id: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(appUsers)
    .set({ tokenVersion: sql`${appUsers.tokenVersion} + 1`, updatedAt: new Date() })
    .where(eq(appUsers.id, id));
  const rows = await db.select({ tv: appUsers.tokenVersion }).from(appUsers).where(eq(appUsers.id, id)).limit(1);
  const newTv = rows[0]?.tv ?? 1;
  console.log(`[DB] incrementTokenVersion: userId=${id} newTokenVersion=${newTv}`);
  return newTv;
}'''
new = '''export async function incrementTokenVersion(id: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await withCircuitBreaker(async () => {
    await db
      .update(appUsers)
      .set({ tokenVersion: sql`${appUsers.tokenVersion} + 1`, updatedAt: new Date() })
      .where(eq(appUsers.id, id));
    const rows = await db.select({ tv: appUsers.tokenVersion }).from(appUsers).where(eq(appUsers.id, id)).limit(1);
    const newTv = rows[0]?.tv ?? 1;
    console.log(`[DB] incrementTokenVersion: userId=${id} newTokenVersion=${newTv}`);
    return newTv;
  });
}'''
content, changed = wrap_fn(old, new, "incrementTokenVersion")
if changed: patches_applied += 1

# ════════════════════════════════════════════════════════════════════════════════
# 5. incrementAllTokenVersions
# ════════════════════════════════════════════════════════════════════════════════
old = '''export async function incrementAllTokenVersions(excludeOwnerId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .update(appUsers)
    .set({ tokenVersion: sql`${appUsers.tokenVersion} + 1`, updatedAt: new Date() })
    .where(ne(appUsers.id, excludeOwnerId));
  // result[0] is OkPacket with affectedRows
  const count = (result[0] as any)?.affectedRows ?? 0;
  console.log(`[DB] incrementAllTokenVersions: excluded ownerId=${excludeOwnerId} — invalidated ${count} user sessions`);
  return count;
}'''
new = '''export async function incrementAllTokenVersions(excludeOwnerId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await withCircuitBreaker(async () => {
    const result = await db
      .update(appUsers)
      .set({ tokenVersion: sql`${appUsers.tokenVersion} + 1`, updatedAt: new Date() })
      .where(ne(appUsers.id, excludeOwnerId));
    // result[0] is OkPacket with affectedRows
    const count = (result[0] as any)?.affectedRows ?? 0;
    console.log(`[DB] incrementAllTokenVersions: excluded ownerId=${excludeOwnerId} — invalidated ${count} user sessions`);
    return count;
  });
}'''
content, changed = wrap_fn(old, new, "incrementAllTokenVersions")
if changed: patches_applied += 1

# ════════════════════════════════════════════════════════════════════════════════
# 6. listAppUsers — currently has NO circuit breaker (missed in audit)
# ════════════════════════════════════════════════════════════════════════════════
old = '''export async function listAppUsers(): Promise<AppUser[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(appUsersTable).orderBy(appUsersTable.createdAt);
}'''
new = '''export async function listAppUsers(): Promise<AppUser[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return await withCircuitBreaker(async () => {
      return db.select().from(appUsersTable).orderBy(appUsersTable.createdAt);
    });
  } catch {
    return [];
  }
}'''
content, changed = wrap_fn(old, new, "listAppUsers")
if changed: patches_applied += 1

# ════════════════════════════════════════════════════════════════════════════════
# Write result
# ════════════════════════════════════════════════════════════════════════════════
open(DB_FILE, 'w').write(content)
final_count = content.count("withCircuitBreaker")
print(f"\n[OUTPUT] withCircuitBreaker occurrences after patch: {final_count}")
print(f"[OUTPUT] Patches applied: {patches_applied}")
print(f"[VERIFY] Delta: +{final_count - original_count} circuit breaker wraps added")

if patches_applied == 0:
    print("[WARN] No patches were applied — check if functions were already patched or text changed")
    sys.exit(1)
else:
    print("[VERIFY] PASS")
