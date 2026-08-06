#!/usr/bin/env Rscript
# Pin down EXACTLY what differs inside .__NAMESPACE__. and inside the help Rd objects.
ROOT <- Sys.getenv("ROOT"); LIB <- Sys.getenv("LIB"); CLEAN <- file.path(ROOT, "tmp", "cleanlib")
pkgs <- c("nflverse", "nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR")
sink(file.path(ROOT, "tmp", "ws-b", "forensic_deep.txt"), split = TRUE)

envsum <- function(e) {
  k <- sort(ls(e, all.names = TRUE))
  vals <- lapply(k, function(n) {
    v <- get(n, envir = e)
    if (is.environment(v)) paste0("<env:", length(ls(v, all.names = TRUE)), ">") else
      paste(deparse(v, control = "all"), collapse = " ")
  })
  setNames(vals, k)
}

for (p in pkgs) {
  cat("\n######", p, "######\n")
  ea <- new.env(); eb <- new.env()
  lazyLoad(file.path(LIB, p, "R", p), envir = ea)
  lazyLoad(file.path(CLEAN, p, "R", p), envir = eb)
  na <- get(".__NAMESPACE__.", envir = ea); nb <- get(".__NAMESPACE__.", envir = eb)
  cat("[.__NAMESPACE__.] keys:", paste(sort(ls(na, all.names = TRUE)), collapse = ","), "\n")
  for (k in sort(ls(na, all.names = TRUE))) {
    va <- get(k, envir = na); vb <- get(k, envir = nb)
    if (is.environment(va) && is.environment(vb)) {
      sa <- envsum(va); sb <- envsum(vb)
      same <- identical(sa, sb)
      cat(sprintf("  %-10s <environment> contents identical: %s (n=%d/%d)\n", k, same, length(sa), length(sb)))
      if (!same) {
        d <- names(sa)[!vapply(names(sa), function(z) identical(sa[[z]], sb[[z]]), logical(1))]
        cat("      differing members:", paste(utils::head(d, 10), collapse = ", "), "\n")
      }
    } else {
      same <- identical(va, vb)
      cat(sprintf("  %-10s identical: %s\n", k, same))
      if (!same) {
        cat("      live:", paste(utils::head(as.character(va), 4), collapse = " | "), "\n")
        cat("      new :", paste(utils::head(as.character(vb), 4), collapse = " | "), "\n")
      }
    }
  }

  # ---- help Rd objects: strip path-bearing attributes, then compare ----
  ha <- new.env(); hb <- new.env()
  lazyLoad(file.path(LIB, p, "help", p), envir = ha)
  lazyLoad(file.path(CLEAN, p, "help", p), envir = hb)
  topics <- sort(ls(ha, all.names = TRUE))
  strip <- function(o) { attr(o, "Rdfile") <- NULL; attr(o, "srcref") <- NULL
                         o[] <- lapply(o, function(z) { attr(z, "srcref") <- NULL; z }); o }
  n_after <- 0; which_after <- character(0)
  rdfile_only_dir <- TRUE; srcref_vec_same <- TRUE
  for (nm in topics) {
    oa <- get(nm, envir = ha); ob <- get(nm, envir = hb)
    if (!identical(basename(attr(oa, "Rdfile")), basename(attr(ob, "Rdfile")))) rdfile_only_dir <- FALSE
    if (!identical(as.integer(attr(oa, "srcref")), as.integer(attr(ob, "srcref")))) srcref_vec_same <- FALSE
    if (!identical(strip(oa), strip(ob))) { n_after <- n_after + 1; which_after <- c(which_after, nm) }
  }
  cat("[help Rd objects] topics:", length(topics), "\n")
  cat("  Rdfile basenames all identical (dir-only difference):", rdfile_only_dir, "\n")
  cat("  srcref integer vectors all identical                :", srcref_vec_same, "\n")
  cat("  topics still differing after stripping Rdfile+srcref:", n_after, "\n")
  if (n_after) cat("    ->", paste(utils::head(which_after, 10), collapse = ", "), "\n")
}
sink()
