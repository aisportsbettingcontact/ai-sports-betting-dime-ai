#!/usr/bin/env Rscript
# Step 1 + Step 2: cross-check the two (three) mirror indices for our 90 packages,
# and verify each Task-0 tarball's md5 against the index MD5sum.
ROOT <- Sys.getenv("ROOT")
W <- file.path(ROOT, "tmp", "ws-b")

acq <- read.csv(file.path(ROOT, "evidence", "acquisition-log.csv"), stringsAsFactors = FALSE)
stopifnot(nrow(acq) == 90)

load_triples <- function(tag) {
  t <- read.csv(file.path(W, sprintf("triples.%s.csv", tag)), stringsAsFactors = FALSE)
  # Records carrying a Path: field are legacy entries for older R versions living in
  # a subdirectory of src/contrib; the mainline current entry has Path = NA. Keep
  # only mainline entries so a legacy duplicate cannot shadow the current one.
  t <- t[is.na(t$path) | t$path == "", ]
  stopifnot(!any(duplicated(t$package)))
  t
}
tp <- load_triples("primary")
tm <- load_triples("mirror2")
to <- load_triples("osuosl")

cat(sprintf("mainline records: primary=%d mirror2=%d osuosl=%d\n", nrow(tp), nrow(tm), nrow(to)))

# ---------- Step 1: full-index cross-check (all packages) ----------
allpkgs <- sort(union(union(tp$package, tm$package), to$package))
idx <- function(t, p) t[match(p, t$package), c("version", "md5sum")]
gp <- idx(tp, allpkgs); gm <- idx(tm, allpkgs); go <- idx(to, allpkgs)
full_pm_ver <- sum(!is.na(gp$version) & !is.na(gm$version) & gp$version != gm$version)
full_pm_md5 <- sum(!is.na(gp$md5sum) & !is.na(gm$md5sum) & gp$md5sum != gm$md5sum)
full_po_ver <- sum(!is.na(gp$version) & !is.na(go$version) & gp$version != go$version)
full_po_md5 <- sum(!is.na(gp$md5sum) & !is.na(go$md5sum) & gp$md5sum != go$md5sum)
only_p <- setdiff(tp$package, to$package); only_o <- setdiff(to$package, tp$package)
cat(sprintf("FULL-INDEX primary-vs-mirror2: ver_diff=%d md5_diff=%d\n", full_pm_ver, full_pm_md5))
cat(sprintf("FULL-INDEX primary-vs-osuosl : ver_diff=%d md5_diff=%d only_primary=%d only_osuosl=%d\n",
            full_po_ver, full_po_md5, length(only_p), length(only_o)))
if (length(only_p)) cat("  only-in-primary:", paste(only_p, collapse=", "), "\n")
if (length(only_o)) cat("  only-in-osuosl :", paste(only_o, collapse=", "), "\n")
po_ver_d <- allpkgs[!is.na(gp$version) & !is.na(go$version) & gp$version != go$version]
if (length(po_ver_d)) {
  cat("  primary-vs-osuosl version-differing packages (mirror lag):\n")
  for (p in po_ver_d) cat(sprintf("    %-24s primary=%-14s osuosl=%s\n", p,
      tp$version[match(p,tp$package)], to$version[match(p,to$package)]))
}
po_md5_only <- allpkgs[!is.na(gp$md5sum) & !is.na(go$md5sum) & gp$md5sum != go$md5sum &
                        !is.na(gp$version) & !is.na(go$version) & gp$version == go$version]
cat(sprintf("  SAME-VERSION-but-DIFFERENT-MD5 (primary vs osuosl), full index: %d\n", length(po_md5_only)))
if (length(po_md5_only)) for (p in po_md5_only) cat(sprintf("    !! %s v%s p=%s o=%s\n", p,
    tp$version[match(p,tp$package)], gp$md5sum[match(p,allpkgs)], go$md5sum[match(p,allpkgs)]))

# ---------- Our 90 ----------
res <- data.frame()
for (i in seq_len(nrow(acq))) {
  pkg <- acq$package[i]; ver <- acq$version[i]; ch <- acq$channel[i]
  tar <- file.path(ROOT, "tarballs", sprintf("%s_%s.tar.gz", pkg, ver))
  md5_actual <- tools::md5sum(tar)[[1]]
  sha_actual <- unname(sub(" .*", "", system(sprintf("shasum -a 256 '%s'", tar), intern = TRUE)))
  jp <- match(pkg, tp$package); jm <- match(pkg, tm$package); jo <- match(pkg, to$package)
  res <- rbind(res, data.frame(
    package = pkg, version = ver, channel = ch,
    md5_actual = md5_actual,
    sha256_task0 = acq$sha256[i],
    sha256_recomputed = sha_actual,
    idx_ver_primary = if (is.na(jp)) NA else tp$version[jp],
    idx_ver_mirror2 = if (is.na(jm)) NA else tm$version[jm],
    idx_ver_osuosl  = if (is.na(jo)) NA else to$version[jo],
    md5_index_primary = if (is.na(jp)) NA else tp$md5sum[jp],
    md5_index_mirror2 = if (is.na(jm)) NA else tm$md5sum[jm],
    md5_index_osuosl  = if (is.na(jo)) NA else to$md5sum[jo],
    stringsAsFactors = FALSE))
}
write.csv(res, file.path(W, "raw90.csv"), row.names = FALSE, na = "NA")

cat("\n---- our 90 ----\n")
cat(sprintf("tarball sha256 recomputed == acquisition-log sha256: %d/90 match\n",
            sum(res$sha256_task0 == res$sha256_recomputed)))
cat(sprintf("installed version == primary index version: %d/90\n", sum(res$version == res$idx_ver_primary, na.rm=TRUE)))
cat(sprintf("installed version == mirror2 index version: %d/90\n", sum(res$version == res$idx_ver_mirror2, na.rm=TRUE)))
cat(sprintf("installed version == osuosl  index version: %d/90\n", sum(res$version == res$idx_ver_osuosl,  na.rm=TRUE)))
cat(sprintf("primary md5 == mirror2 md5 (our 90): %d/90\n", sum(res$md5_index_primary == res$md5_index_mirror2, na.rm=TRUE)))
cat(sprintf("primary md5 == osuosl  md5 (our 90): %d/90\n", sum(res$md5_index_primary == res$md5_index_osuosl,  na.rm=TRUE)))
cat(sprintf("md5_actual  == primary md5 (our 90): %d/90\n", sum(res$md5_actual == res$md5_index_primary, na.rm=TRUE)))
v <- res[res$version != res$idx_ver_osuosl | is.na(res$idx_ver_osuosl), ]
if (nrow(v)) { cat("osuosl version mismatches among our 90:\n"); print(v[, c("package","version","idx_ver_primary","idx_ver_osuosl")]) }
m <- res[res$md5_actual != res$md5_index_primary, ]
if (nrow(m)) { cat("!! md5 mismatch vs primary index:\n"); print(m[, c("package","version","md5_actual","md5_index_primary")]) }
