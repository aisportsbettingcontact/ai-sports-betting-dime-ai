#!/usr/bin/env Rscript
# Task 1 / WS-A / Step 4: Acceptance check.
# Cross-validates the three artifacts against each other and against the
# shared manifest, and prints a summary block to be transcribed into notes.md.

ROOT <- Sys.getenv("ROOT")
LIB  <- Sys.getenv("LIB", "/opt/homebrew/lib/R/4.6/site-library")

manifest <- read.csv(file.path(ROOT, "evidence", "installed-manifest.csv"), stringsAsFactors = FALSE)
edges    <- read.csv(file.path(ROOT, "evidence", "ws-a", "dep-edges.csv"), stringsAsFactors = FALSE)
currency <- read.csv(file.path(ROOT, "evidence", "ws-a", "currency.csv"), stringsAsFactors = FALSE)
reach_txt <- readLines(file.path(ROOT, "evidence", "ws-a", "reachability.txt"))

TARGETS <- c("nflverse", "nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR")
installed_pkgs <- sort(list.dirs(LIB, recursive = FALSE, full.names = FALSE))

ok <- TRUE
check <- function(desc, cond) {
  status <- if (isTRUE(cond)) "PASS" else "FAIL"
  cat(sprintf("[%s] %s\n", status, desc))
  if (!isTRUE(cond)) ok <<- FALSE
  invisible(cond)
}

cat("=== Acceptance checks ===\n")
check("manifest has 90 rows", nrow(manifest) == 90)
check("LIB has 90 package dirs", length(installed_pkgs) == 90)
check("manifest package set == LIB dir set", setequal(manifest$package, installed_pkgs))

check("currency.csv has 90 data rows", nrow(currency) == 90)
check("currency.csv package set == manifest package set (every one of the 90 appears)",
      setequal(currency$package, manifest$package))
check("currency.csv has no duplicate packages", length(unique(currency$package)) == nrow(currency))
check("currency.csv header is package,installed,cran_current,status,github_dev",
      identical(names(currency), c("package", "installed", "cran_current", "status", "github_dev")))
check("currency.csv status values all in {current,outdated,archived-or-missing}",
      all(currency$status %in% c("current", "outdated", "archived-or-missing")))
check("currency.csv github_dev non-empty ONLY for the 6 targets",
      setequal(currency$package[nzchar(currency$github_dev)], TARGETS) ||
        all(currency$package[nzchar(currency$github_dev)] %in% TARGETS))

check("dep-edges.csv header is from,to,type", identical(names(edges), c("from", "to", "type")))
check("dep-edges.csv type values all in {Depends,Imports,LinkingTo,Suggests}",
      all(edges$type %in% c("Depends", "Imports", "LinkingTo", "Suggests")))
check("dep-edges.csv has no 'R' as a to-target (must be excluded)", !any(edges$to == "R"))
check("dep-edges.csv 'from' set is a subset of the 90 installed packages (no phantom sources)",
      all(unique(edges$from) %in% installed_pkgs))
zero_outdeg <- setdiff(installed_pkgs, unique(edges$from))
cat(sprintf("  (info) %d of 90 packages have ZERO outgoing edges (Depends/Imports/LinkingTo/Suggests all empty once R is excluded): %s\n",
            length(zero_outdeg), paste(zero_outdeg, collapse = ", ")))
check("dep-edges.csv edge count is 'hundreds, not tens' (plausibility)", nrow(edges) >= 200 && nrow(edges) <= 5000)

roots_block_idx <- grep("^ROOTS", reach_txt)
check("reachability.txt has a ROOTS( header line", length(roots_block_idx) == 1)
next_blank <- roots_block_idx[1] + which(reach_txt[(roots_block_idx[1] + 1):length(reach_txt)] == "")[1] - 1
roots_block <- reach_txt[(roots_block_idx[1] + 1):next_blank]
check("reachability.txt mentions all 6 targets in its ROOTS block",
      all(sapply(TARGETS, function(t) any(grepl(t, roots_block, fixed = TRUE)))))

cat("\n=== Counts for notes.md ===\n")
cat(sprintf("dep-edges.csv total edges: %d\n", nrow(edges)))
print(table(edges$type))
cat(sprintf("dep-edges.csv distinct 'from' packages: %d (of 90)\n", length(unique(edges$from))))
cat(sprintf("dep-edges.csv distinct 'to' targets: %d\n", length(unique(edges$to))))

reachable_line <- grep("^REACHABLE_IN_SITE_LIBRARY", reach_txt, value = TRUE)
orphans_line   <- grep("^ORPHANS", reach_txt, value = TRUE)
cat(sprintf("reachability: %s\n", reachable_line))
cat(sprintf("reachability: %s\n", orphans_line))

cat("\ncurrency status breakdown:\n")
print(table(currency$status))

cat("\ngithub_dev vs cran_current for the 6 targets (dev-ahead-of-CRAN check):\n")
tg <- currency[currency$package %in% TARGETS, c("package", "installed", "cran_current", "github_dev")]
tg$dev_ahead_of_cran <- mapply(function(g, c) {
  if (!nzchar(g)) return(NA)
  tryCatch(package_version(g) > package_version(c), error = function(e) NA)
}, tg$github_dev, tg$cran_current)
print(tg)

cat(sprintf("\nOverall acceptance: %s\n", if (ok) "ALL PASS" else "SOME FAILED -- see above"))
