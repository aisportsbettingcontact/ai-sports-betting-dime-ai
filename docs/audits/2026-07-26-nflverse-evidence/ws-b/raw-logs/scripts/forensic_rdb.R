#!/usr/bin/env Rscript
# Forensic comparison of the lazy-load databases (R/*.rdb+rdx, help/*.rdb+rdx)
# and help/paths.rds between the live $LIB install and the clean rebuild.
#
# The .rdb/.rdx pair is a compressed blob store; raw byte comparison is
# meaningless. We compare the DESERIALIZED objects instead, which is what
# actually determines package behaviour.
ROOT <- Sys.getenv("ROOT"); LIB <- Sys.getenv("LIB")
CLEAN <- file.path(ROOT, "tmp", "cleanlib")
pkgs <- c("nflverse", "nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR")
out <- file.path(ROOT, "tmp", "ws-b", "forensic_rdb.txt")
sink(out, split = TRUE)

for (p in pkgs) {
  cat("\n################ ", p, " ################\n")

  ## ---- help/paths.rds ----
  a <- readRDS(file.path(LIB, p, "help", "paths.rds"))
  b <- readRDS(file.path(CLEAN, p, "help", "paths.rds"))
  cat("[help/paths.rds]\n")
  cat("  n_entries live/new      :", length(a), "/", length(b), "\n")
  cat("  basenames identical     :", identical(basename(a), basename(b)), "\n")
  cat("  attributes identical    :", identical(attributes(a), attributes(b)), "\n")
  cat("  n distinct dirs live/new:", length(unique(dirname(a))), "/", length(unique(dirname(b))), "\n")
  cat("  dir live                :", unique(dirname(a)), "\n")
  cat("  dir new                 :", unique(dirname(b)), "\n")
  cat("  -> differs ONLY in the ephemeral R.INSTALL staging dir:",
      identical(basename(a), basename(b)) && identical(attributes(a), attributes(b)), "\n")

  ## ---- .rdx index files ----
  for (sub in c("R", "help")) {
    xa <- readRDS(file.path(LIB, p, sub, paste0(p, ".rdx")))
    xb <- readRDS(file.path(CLEAN, p, sub, paste0(p, ".rdx")))
    cat(sprintf("[%s/%s.rdx]\n", sub, p))
    cat("  top-level names         :", paste(names(xa), collapse = ","), "\n")
    cat("  variable NAMES identical:", identical(sort(names(xa$variables)), sort(names(xb$variables))), "\n")
    cat("  n variables live/new    :", length(xa$variables), "/", length(xb$variables), "\n")
    la <- vapply(xa$variables, function(z) z[2], numeric(1))
    lb <- vapply(xb$variables[names(xa$variables)], function(z) z[2], numeric(1))
    cat("  blob LENGTHS identical  :", identical(unname(la), unname(lb)), "\n")
    if (!identical(unname(la), unname(lb))) {
      d <- names(la)[la != lb]
      cat("    blobs differing in compressed length:", length(d), "of", length(la), "\n")
      cat("    e.g.:", paste(utils::head(d, 5), collapse = ", "), "\n")
    }
    oa <- vapply(xa$variables, function(z) z[1], numeric(1))
    ob <- vapply(xb$variables[names(xa$variables)], function(z) z[1], numeric(1))
    cat("  offsets identical       :", identical(unname(oa), unname(ob)), "\n")
    cat("  compressed flag live/new:", xa$compressed, "/", xb$compressed, "\n")
    cat("  references identical    :", identical(xa$references, xb$references), "\n")
  }

  ## ---- R/*.rdb : compare deserialized objects ----
  ea <- new.env(); eb <- new.env()
  lazyLoad(file.path(LIB, p, "R", p), envir = ea)
  lazyLoad(file.path(CLEAN, p, "R", p), envir = eb)
  na <- sort(ls(ea, all.names = TRUE)); nb <- sort(ls(eb, all.names = TRUE))
  cat("[R/", p, ".rdb - deserialized objects]\n", sep = "")
  cat("  n objects live/new      :", length(na), "/", length(nb), "\n")
  cat("  object NAMES identical  :", identical(na, nb), "\n")
  if (!identical(na, nb)) {
    cat("    ONLY LIVE:", paste(setdiff(na, nb), collapse = ", "), "\n")
    cat("    ONLY NEW :", paste(setdiff(nb, na), collapse = ", "), "\n")
  }
  common <- intersect(na, nb)
  diff_ignoreenv <- character(0); diff_deparse <- character(0); diff_serial <- character(0)
  for (nm in common) {
    oa <- get(nm, envir = ea); ob <- get(nm, envir = eb)
    if (!isTRUE(all.equal(oa, ob, check.environment = FALSE))) diff_ignoreenv <- c(diff_ignoreenv, nm)
    da <- tryCatch(deparse(oa, control = c("all")), error = function(e) "ERR")
    db <- tryCatch(deparse(ob, control = c("all")), error = function(e) "ERR")
    if (!identical(da, db)) diff_deparse <- c(diff_deparse, nm)
    # serialize with environments stripped for closures -> pure code+formals payload
    sa <- tryCatch(serialize(if (is.function(oa)) { environment(oa) <- globalenv(); oa } else oa, NULL, version = 3),
                   error = function(e) raw(0))
    sb <- tryCatch(serialize(if (is.function(ob)) { environment(ob) <- globalenv(); ob } else ob, NULL, version = 3),
                   error = function(e) raw(0))
    if (!identical(sa, sb)) diff_serial <- c(diff_serial, nm)
  }
  cat("  all.equal(check.environment=FALSE) mismatches:", length(diff_ignoreenv), "\n")
  if (length(diff_ignoreenv)) cat("    ->", paste(diff_ignoreenv, collapse = ", "), "\n")
  cat("  deparse(control='all') mismatches           :", length(diff_deparse), "\n")
  if (length(diff_deparse)) cat("    ->", paste(diff_deparse, collapse = ", "), "\n")
  cat("  serialize() mismatches (env normalized)     :", length(diff_serial), "\n")
  if (length(diff_serial)) cat("    ->", paste(utils::head(diff_serial, 20), collapse = ", "), "\n")

  ## ---- help/*.rdb : compare deserialized Rd objects ----
  ha <- new.env(); hb <- new.env()
  lazyLoad(file.path(LIB, p, "help", p), envir = ha)
  lazyLoad(file.path(CLEAN, p, "help", p), envir = hb)
  hna <- sort(ls(ha, all.names = TRUE)); hnb <- sort(ls(hb, all.names = TRUE))
  cat("[help/", p, ".rdb - deserialized Rd objects]\n", sep = "")
  cat("  n topics live/new       :", length(hna), "/", length(hnb), "\n")
  cat("  topic NAMES identical   :", identical(hna, hnb), "\n")
  hd <- character(0); hd_txt <- character(0)
  for (nm in intersect(hna, hnb)) {
    oa <- get(nm, envir = ha); ob <- get(nm, envir = hb)
    if (!identical(oa, ob)) hd <- c(hd, nm)
    ta <- tryCatch(paste(capture.output(print(oa)), collapse = "\n"), error = function(e) "ERR")
    tb <- tryCatch(paste(capture.output(print(ob)), collapse = "\n"), error = function(e) "ERR")
    if (!identical(ta, tb)) hd_txt <- c(hd_txt, nm)
  }
  cat("  identical() mismatches  :", length(hd), "\n")
  if (length(hd)) cat("    ->", paste(utils::head(hd, 20), collapse = ", "), "\n")
  cat("  rendered-text mismatches:", length(hd_txt), "\n")
  if (length(hd_txt)) cat("    ->", paste(utils::head(hd_txt, 20), collapse = ", "), "\n")
}
sink()
