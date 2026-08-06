#!/usr/bin/env Rscript
# Task 1 / WS-A / Step 2: Compute reachability from the 6 nflverse targets
# over hard-dependency edges (Depends + Imports + LinkingTo only; Suggests
# excluded per brief). BFS starting at the 6 targets. Orphans = installed
# (site-library, 90 pkgs) minus reachable.
#
# Run: Rscript --vanilla 02-reachability.R

LIB  <- Sys.getenv("LIB", "/opt/homebrew/lib/R/4.6/site-library")
ROOT <- Sys.getenv("ROOT")
if (identical(ROOT, "")) stop("ROOT env var not set")

EDGES_CSV <- file.path(ROOT, "evidence", "ws-a", "dep-edges.csv")
OUT_TXT   <- file.path(ROOT, "evidence", "ws-a", "reachability.txt")

TARGETS <- c("nflverse", "nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR")

edges <- read.csv(EDGES_CSV, stringsAsFactors = FALSE)
stopifnot(all(c("from", "to", "type") %in% names(edges)))

hard <- edges[edges$type %in% c("Depends", "Imports", "LinkingTo"), ]

installed <- sort(list.dirs(LIB, recursive = FALSE, full.names = FALSE))
stopifnot(length(installed) == 90)
stopifnot(all(TARGETS %in% installed))

# adjacency lookup (from -> character vector of to)
adj <- split(hard$to, hard$from)

# BFS from the 6 targets
visited <- character(0)
queue <- TARGETS
while (length(queue) > 0) {
  cur <- queue[1]
  queue <- queue[-1]
  if (cur %in% visited) next
  visited <- c(visited, cur)
  nbrs <- adj[[cur]]
  if (!is.null(nbrs)) {
    new_nodes <- setdiff(unique(nbrs), visited)
    queue <- c(queue, new_nodes)
  }
}
visited <- sort(unique(visited))

reachable_in_lib   <- intersect(visited, installed)          # reachable AND part of the 90
reachable_outside  <- sort(setdiff(visited, installed))      # reachable but base/recommended or not installed at all
orphans            <- sort(setdiff(installed, visited))      # installed, NOT reachable from targets

# classify reachable_outside: base/recommended (present in the non-site-library
# R "library") vs genuinely absent (not installed anywhere on this system,
# e.g. an Imports/Depends target that isn't actually present -- would be a
# real anomaly worth flagging)
BASE_LIB <- Sys.getenv("BASE_LIB", "/opt/homebrew/lib/R/library")
base_recommended <- character(0)
if (dir.exists(BASE_LIB)) {
  base_recommended <- sort(list.dirs(BASE_LIB, recursive = FALSE, full.names = FALSE))
}
reachable_outside_base <- intersect(reachable_outside, base_recommended)
reachable_outside_unresolved <- setdiff(reachable_outside, base_recommended)

# For each orphan, gather forensic context to help notes.md explain *why*
# it's installed: which of the 90 (if any) pulls it in, and via which edge
# type(s). This is edge-list-driven, not a guess.
orphan_context <- lapply(orphans, function(pkg) {
  incoming <- edges[edges$to == pkg, c("from", "type")]
  incoming <- incoming[order(incoming$from, incoming$type), ]
  list(pkg = pkg, incoming = incoming)
})
names(orphan_context) <- orphans

lines <- c(
  "# Reachability report -- nflverse forensic audit (Task 1 / WS-A / Step 2)",
  sprintf("# Generated: %s", format(Sys.time(), tz = "UTC", usetz = TRUE)),
  sprintf("# Edge source: %s (hard deps only: Depends+Imports+LinkingTo; Suggests excluded)", EDGES_CSV),
  sprintf("# LIB (site-library, the 90 installed pkgs under audit): %s", LIB),
  "",
  sprintf("ROOTS (%d) -- the 6 nflverse targets, BFS start set:", length(TARGETS)),
  sprintf("  %s", TARGETS),
  "",
  sprintf("REACHABLE_IN_SITE_LIBRARY (%d of %d installed pkgs, hard-dep closure of the 6 targets):", length(reachable_in_lib), length(installed)),
  paste0("  ", reachable_in_lib),
  "",
  sprintf("REACHABLE_OUTSIDE_SITE_LIBRARY -- base/recommended R packages pulled in as hard-dep targets (%d):", length(reachable_outside_base)),
  paste0("  ", reachable_outside_base),
  "",
  sprintf("REACHABLE_OUTSIDE_SITE_LIBRARY -- referenced as hard-dep target but NOT found in site-library OR base/recommended library (%d):", length(reachable_outside_unresolved)),
  paste0("  ", reachable_outside_unresolved),
  "",
  sprintf("ORPHANS (%d of %d installed pkgs -- installed in site-library but NOT reachable from the 6 targets via hard deps):", length(orphans), length(installed)),
  paste0("  ", orphans),
  "",
  "# --- Orphan forensic detail: incoming edges from any of the 90, by type ---",
  "# (an orphan with only Suggests-in edges is a soft/optional pull-in; one with",
  "#  no incoming edges at all was installed by install.packages() dependency",
  "#  resolution for a reason not visible in any of the 90 installed DESCRIPTIONs",
  "#  -- e.g. a dependency of one of the 90's Suggests-of-Suggests during initial",
  "#  install, or installed standalone/manually.)",
  ""
)

for (pkg in orphans) {
  inc <- orphan_context[[pkg]]$incoming
  if (nrow(inc) == 0) {
    lines <- c(lines, sprintf("  %s: NO incoming edges from any of the 90 installed DESCRIPTIONs", pkg))
  } else {
    by_type <- tapply(inc$from, inc$type, function(x) paste(sort(x), collapse = ", "))
    detail <- paste(sprintf("%s<-[%s]", names(by_type), by_type), collapse = "; ")
    lines <- c(lines, sprintf("  %s: %s", pkg, detail))
  }
}

writeLines(lines, OUT_TXT)

cat(sprintf("ROOTS: %d\n", length(TARGETS)))
cat(sprintf("REACHABLE_IN_SITE_LIBRARY: %d\n", length(reachable_in_lib)))
cat(sprintf("REACHABLE_OUTSIDE (base/recommended): %d\n", length(reachable_outside_base)))
cat(sprintf("REACHABLE_OUTSIDE (unresolved): %d\n", length(reachable_outside_unresolved)))
cat(sprintf("ORPHANS: %d\n", length(orphans)))
cat(sprintf("Sanity: reachable_in_lib + orphans == installed? %s (%d + %d = %d, installed=%d)\n",
            (length(reachable_in_lib) + length(orphans)) == length(installed),
            length(reachable_in_lib), length(orphans),
            length(reachable_in_lib) + length(orphans), length(installed)))
cat(sprintf("Wrote %s\n", OUT_TXT))
