#!/usr/bin/env Rscript
# Step 5: classify every path difference between the CRAN tarball tree and the
# GitHub tree at the release tag.
#
# Classification buckets:
#   repo-only      : present only in git; MUST be justified by an actual
#                    .Rbuildignore regex (R CMD build semantics: perl=TRUE,
#                    ignore.case=TRUE, matched on the path relative to pkg root)
#                    or by R CMD build's built-in always-exclude list.
#   repo-only-UNEXPLAINED : present only in git, NOT matched by any rule -> finding
#   tarball-only   : present only in the tarball; build artifacts (MD5, build/,
#                    inst/doc, configured vignettes) are expected, anything else
#                    is a finding.
#   content-diff   : present in both but differing bytes -> inspected, and a
#                    finding if it lands in R/, data/, src/, NAMESPACE,
#                    DESCRIPTION or configure.
ROOT <- Sys.getenv("ROOT")
args <- commandArgs(trailingOnly = TRUE)
pkg <- args[1]; ghdir <- args[2]

A <- file.path(ROOT, "sources", pkg)   # CRAN tarball tree
B <- ghdir                             # git tree

lsrel <- function(d, exclude_git = TRUE) {
  f <- list.files(d, recursive = TRUE, all.files = TRUE, no.. = TRUE, include.dirs = FALSE)
  if (exclude_git) f <- f[!grepl("^\\.git(/|$)", f)]
  sort(f)
}
fa <- lsrel(A); fb <- lsrel(B)

# --- R CMD build's built-in always-excluded patterns (subset that can appear here) ---
# NB: R's own hidden-file exclusion list (tools) drops .gitignore /
# .gitattributes / .Rhistory etc. at ANY depth, not just the package root.
builtin <- c("^\\.Rbuildignore$", "^\\.git($|/)", "(^|/)\\.gitignore$",
             "(^|/)\\.gitattributes$", "(^|/)\\.gitmodules$",
             "^\\.svn($|/)", "^\\.hg($|/)", "(^|/)\\.hgignore$", "(^|/)\\.hgtags$",
             "(^|/)\\.DS_Store$", "^Read-and-delete-me$",
             "(^|/)\\.Rhistory$", "(^|/)\\.RData$", "(^|/)\\.Renviron$",
             "(^|/)\\.Rprofile$", "~$", "^\\.Rproj\\.user($|/)",
             "(^|/)#.*#$", "(^|/)\\.#")

rbi_file <- file.path(B, ".Rbuildignore")
rbi <- if (file.exists(rbi_file)) {
  x <- readLines(rbi_file, warn = FALSE); x <- trimws(x); x[nzchar(x) & !grepl("^#", x)]
} else character(0)

matches_any <- function(path, pats) {
  if (!length(pats)) return(FALSE)
  any(vapply(pats, function(p)
    isTRUE(tryCatch(grepl(p, path, perl = TRUE, ignore.case = TRUE), error = function(e) FALSE)),
    logical(1)))
}
# R CMD build prunes whole DIRECTORIES, so a rule like "^\.github$" removes
# .github/workflows/x.yaml even though it does not match that full path.
# Test the path itself and every ancestor directory prefix.
path_and_ancestors <- function(path) {
  parts <- strsplit(path, "/", fixed = TRUE)[[1]]
  if (length(parts) <= 1) return(path)
  c(path, vapply(seq_len(length(parts) - 1),
                 function(i) paste(parts[seq_len(i)], collapse = "/"), character(1)))
}
which_rule <- function(path, pats) {
  cand <- path_and_ancestors(path)
  for (p in pats) for (cc in cand)
    if (isTRUE(tryCatch(grepl(p, cc, perl = TRUE, ignore.case = TRUE),
                        error = function(e) FALSE)))
      return(if (identical(cc, path)) p else paste0(p, "  [via dir '", cc, "']"))
  NA_character_
}

only_b <- setdiff(fb, fa)   # repo-only
only_a <- setdiff(fa, fb)   # tarball-only
both   <- intersect(fa, fb)

# byte compare the intersection
h <- function(root, f) unname(tools::md5sum(file.path(root, f)))
differ <- both[vapply(both, function(f) {
  ha <- h(A, f); hb <- h(B, f); is.na(ha) || is.na(hb) || ha != hb }, logical(1))]

cat("PACKAGE:", pkg, "\n")
cat("tarball tree:", A, "\n"); cat("github tree :", B, "\n")
cat(sprintf("files: tarball=%d github=%d  repo-only=%d tarball-only=%d in-both=%d differing=%d\n\n",
            length(fa), length(fb), length(only_b), length(only_a), length(both), length(differ)))

cat("=================== REPO-ONLY (present only in git) ===================\n")
unexpl <- character(0)
for (f in only_b) {
  r <- which_rule(f, rbi)
  if (!is.na(r)) { cat(sprintf("  [.Rbuildignore] %-52s  rule: %s\n", f, r)); next }
  r2 <- which_rule(f, builtin)
  if (!is.na(r2)) { cat(sprintf("  [build-builtin] %-52s  rule: %s\n", f, r2)); next }
  cat(sprintf("  [UNEXPLAINED!!] %s\n", f)); unexpl <- c(unexpl, f)
}
if (!length(only_b)) cat("  (none)\n")
cat(sprintf("\n  repo-only unexplained by any rule: %d\n", length(unexpl)))

cat("\n=================== TARBALL-ONLY (present only in tarball) ===================\n")
artifact_pat <- c("^MD5$", "^build(/|$)", "^inst/doc(/|$)")
tb_unexpected <- character(0)
for (f in only_a) {
  if (matches_any(f, artifact_pat)) cat(sprintf("  [build-artifact] %s\n", f))
  else { cat(sprintf("  [UNEXPECTED!!]   %s\n", f)); tb_unexpected <- c(tb_unexpected, f) }
}
if (!length(only_a)) cat("  (none)\n")
cat(sprintf("\n  tarball-only NOT a recognised build artifact: %d\n", length(tb_unexpected)))

cat("\n=================== CONTENT DIFFERENCES (in both, bytes differ) ===================\n")
crit_pat <- c("^R/", "^data/", "^src/", "^NAMESPACE$", "^DESCRIPTION$", "^configure")
crit <- differ[vapply(differ, matches_any, logical(1), crit_pat)]
noncrit <- setdiff(differ, crit)
cat(sprintf("  CRITICAL-PATH differences (R/ data/ src/ NAMESPACE DESCRIPTION configure): %d\n", length(crit)))
for (f in crit) cat("    *", f, "\n")
cat(sprintf("  other differing files: %d\n", length(noncrit)))
for (f in noncrit) cat("    -", f, "\n")

writeLines(differ,   file.path(ROOT, "tmp", "ws-b", paste0("ghdiff.", pkg, ".differ.txt")))
writeLines(crit,     file.path(ROOT, "tmp", "ws-b", paste0("ghdiff.", pkg, ".crit.txt")))
writeLines(unexpl,   file.path(ROOT, "tmp", "ws-b", paste0("ghdiff.", pkg, ".unexpl.txt")))
writeLines(tb_unexpected, file.path(ROOT, "tmp", "ws-b", paste0("ghdiff.", pkg, ".tbunexp.txt")))
