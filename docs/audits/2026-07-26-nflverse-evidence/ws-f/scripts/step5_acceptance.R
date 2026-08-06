#!/usr/bin/env Rscript
# Step 5: acceptance check, run programmatically (not by eyeballing).
ROOT <- "/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit"
OUT_DIR <- file.path(ROOT, "evidence", "ws-f")

cat("=== Check A: exports.csv non-empty per package ===\n")
ex <- read.csv(file.path(OUT_DIR, "exports.csv"), stringsAsFactors = FALSE)
targets <- c("nflverse", "nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR")
tab <- table(ex$package)
all_ok <- TRUE
for (pkg in targets) {
  n <- if (pkg %in% names(tab)) tab[[pkg]] else 0
  ok <- n > 0
  all_ok <- all_ok && ok
  cat(sprintf("  %-10s n=%-4d %s\n", pkg, n, if (ok) "OK" else "FAIL"))
}
cat("Check A overall:", if (all_ok) "PASS" else "FAIL", "\n\n")

cat("=== Check B: every dictionary_* has a CSV (recount) ===\n")
listed <- data(package = "nflreadr")$results[, "Item"]
dicts <- sort(grep("^dictionary_", listed, value = TRUE), method = "radix")
have_files <- list.files(file.path(OUT_DIR, "dictionaries"), pattern = "\\.csv$")
have <- sort(sub("\\.csv$", "", have_files), method = "radix")
cat("data(package=\"nflreadr\") dictionary_* count:", length(dicts), "\n")
cat("dictionaries/*.csv file count:", length(have), "\n")
missing <- setdiff(dicts, have)
extra <- setdiff(have, dicts)
cat("missing (listed, no csv):", if (length(missing)) paste(missing, collapse = ", ") else "(none)", "\n")
cat("extra (csv, not listed):", if (length(extra)) paste(extra, collapse = ", ") else "(none)", "\n")
checkB <- identical(dicts, have)
cat("Check B overall:", if (checkB) "PASS (exact set match)" else "FAIL", "\n\n")

cat("=== Check C: every dictionary CSV is non-empty (nrow > 0) and readable ===\n")
all_nonempty <- TRUE
for (nm in have) {
  p <- file.path(OUT_DIR, "dictionaries", paste0(nm, ".csv"))
  d <- tryCatch(read.csv(p, stringsAsFactors = FALSE), error = function(e) NULL)
  ok <- !is.null(d) && nrow(d) > 0
  all_nonempty <- all_nonempty && ok
  if (!ok) cat("  FAIL:", nm, "\n")
}
cat("Check C overall:", if (all_nonempty) "PASS (all 22 non-empty & parse cleanly)" else "FAIL", "\n\n")

cat("=== Check D: exports.csv header exact match to contract ===\n")
hdr <- names(ex)
expected <- c("package", "symbol", "kind", "signature", "title")
cat("actual header:", paste(hdr, collapse = ","), "\n")
cat("Check D overall:", if (identical(hdr, expected)) "PASS" else "FAIL", "\n\n")

cat("=== Check E: exports.csv sorted by package,symbol ===\n")
ord <- order(ex$package, ex$symbol, method = "radix")
cat("Check E overall:", if (identical(ord, seq_len(nrow(ex)))) "PASS" else "FAIL", "\n\n")

cat("=== Check F: no ERROR kind rows (no unresolved symbols) ===\n")
n_err <- sum(ex$kind == "ERROR")
cat("ERROR rows:", n_err, "\n")
cat("Check F overall:", if (n_err == 0) "PASS" else "FAIL", "\n\n")

cat("=== TOTAL ROWS:", nrow(ex), "===\n")
