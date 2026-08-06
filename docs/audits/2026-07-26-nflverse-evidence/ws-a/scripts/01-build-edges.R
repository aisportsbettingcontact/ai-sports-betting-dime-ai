#!/usr/bin/env Rscript
# Task 1 / WS-A / Step 1: Build dependency edge list from installed DESCRIPTIONs.
#
# Reads every DESCRIPTION file under $LIB (the 90 site-library packages),
# parses Depends/Imports/LinkingTo/Suggests with tools:::.split_dependencies
# (falls back to a manual regex split if that internal ever fails on a
# malformed field), strips version qualifiers, excludes "R" itself, and
# writes one row per (from, to, type) edge to dep-edges.csv.
#
# Run: Rscript --vanilla 01-build-edges.R

args <- commandArgs(trailingOnly = TRUE)
LIB  <- Sys.getenv("LIB", "/opt/homebrew/lib/R/4.6/site-library")
ROOT <- Sys.getenv("ROOT")
if (identical(ROOT, "")) stop("ROOT env var not set")
OUT_CSV   <- file.path(ROOT, "evidence", "ws-a", "dep-edges.csv")
LOG_FILE  <- file.path(ROOT, "evidence", "ws-a", "scripts", "01-build-edges.log")

log_lines <- character(0)
logmsg <- function(...) {
  m <- sprintf(...)
  log_lines <<- c(log_lines, m)
  cat(m, "\n", sep = "")
}

dep_types <- c("Depends", "Imports", "LinkingTo", "Suggests")

# Manual fallback splitter, used only if tools:::.split_dependencies errors.
manual_split <- function(field_value) {
  # split on top-level commas (dependency lists never nest commas outside
  # the "(>= x.y)" parens, and there are none of those in field_value at
  # this point besides the version parens, which themselves contain no commas)
  parts <- strsplit(field_value, ",")[[1]]
  parts <- trimws(gsub("\\s+", " ", parts))
  parts <- gsub("\\s*\\([^)]*\\)\\s*$", "", parts)  # drop trailing "(>= 1.0)" etc
  parts <- trimws(parts)
  parts[nzchar(parts)]
}

split_field <- function(field_value, pkg, type) {
  if (is.na(field_value)) return(character(0))
  parsed <- tryCatch(tools:::.split_dependencies(field_value), error = function(e) NULL)
  if (is.null(parsed)) {
    logmsg("WARN: tools:::.split_dependencies failed for %s/%s, using manual regex fallback", pkg, type)
    return(manual_split(field_value))
  }
  if (length(parsed) == 0) return(character(0))
  vapply(parsed, function(x) x$name, character(1))
}

pkgs <- sort(list.dirs(LIB, recursive = FALSE, full.names = FALSE))
logmsg("Found %d package directories under LIB=%s", length(pkgs), LIB)

edge_from <- character(0)
edge_to   <- character(0)
edge_type <- character(0)

missing_desc <- character(0)

for (pkg in pkgs) {
  desc_path <- file.path(LIB, pkg, "DESCRIPTION")
  if (!file.exists(desc_path)) {
    missing_desc <- c(missing_desc, pkg)
    logmsg("WARN: no DESCRIPTION for %s", pkg)
    next
  }
  d <- read.dcf(desc_path, fields = dep_types)
  for (type in dep_types) {
    val <- d[1, type]
    names_ <- split_field(val, pkg, type)
    names_ <- names_[!is.na(names_) & nzchar(names_)]
    names_ <- names_[names_ != "R"]  # exclude R itself per brief
    if (length(names_) == 0) next
    edge_from <- c(edge_from, rep(pkg, length(names_)))
    edge_to   <- c(edge_to, names_)
    edge_type <- c(edge_type, rep(type, length(names_)))
  }
}

edges <- data.frame(from = edge_from, to = edge_to, type = edge_type, stringsAsFactors = FALSE)
edges <- edges[order(edges$from, edges$type, edges$to), ]

# Sanity: no "R" survived, no NA/empty fields
stopifnot(!any(edges$to == "R"))
stopifnot(!any(is.na(edges$from) | is.na(edges$to) | is.na(edges$type)))
stopifnot(!any(edges$from == "" | edges$to == ""))

write.table(edges, OUT_CSV, sep = ",", row.names = FALSE, col.names = c("from", "to", "type"),
            quote = FALSE)

logmsg("Wrote %d edges (from %d packages with DESCRIPTIONs) to %s", nrow(edges), length(pkgs) - length(missing_desc), OUT_CSV)
by_type <- table(edges$type)
for (t in names(by_type)) logmsg("  type=%s: %d edges", t, by_type[[t]])
logmsg("Distinct 'to' targets: %d", length(unique(edges$to)))
logmsg("Distinct 'to' targets NOT among the %d site-library packages: %d", length(pkgs), length(setdiff(unique(edges$to), pkgs)))

writeLines(log_lines, LOG_FILE)
