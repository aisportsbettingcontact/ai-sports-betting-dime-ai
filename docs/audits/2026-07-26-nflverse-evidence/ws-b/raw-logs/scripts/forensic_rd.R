#!/usr/bin/env Rscript
# Definitive test on the help/*.rdb Rd objects: recursively strip every
# build-path-bearing attribute (Rdfile, srcref, srcfile) and compare the
# remaining documentation structure + content.
ROOT <- Sys.getenv("ROOT"); LIB <- Sys.getenv("LIB"); CLEAN <- file.path(ROOT, "tmp", "cleanlib")
pkgs <- c("nflverse", "nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR")
sink(file.path(ROOT, "tmp", "ws-b", "forensic_rd.txt"), split = TRUE)

# recursively drop srcref/srcfile/Rdfile/wholeSrcref attributes everywhere
deep_strip <- function(x) {
  a <- attributes(x)
  if (!is.null(a)) {
    drop <- c("srcref", "srcfile", "Rdfile", "wholeSrcref")
    keep <- a[setdiff(names(a), drop)]
  } else keep <- NULL
  if (is.list(x)) {
    y <- lapply(x, deep_strip)
    attributes(y) <- keep
    y
  } else {
    y <- x
    attributes(y) <- keep
    y
  }
}

tot_topics <- 0; tot_diff <- 0
for (p in pkgs) {
  ha <- new.env(); hb <- new.env()
  lazyLoad(file.path(LIB, p, "help", p), envir = ha)
  lazyLoad(file.path(CLEAN, p, "help", p), envir = hb)
  topics <- sort(ls(ha, all.names = TRUE))
  diffs <- character(0); txtdiffs <- character(0)
  for (nm in topics) {
    oa <- deep_strip(get(nm, envir = ha)); ob <- deep_strip(get(nm, envir = hb))
    if (!identical(oa, ob)) diffs <- c(diffs, nm)
    # independent corroboration: render each topic to plain text
    ta <- tryCatch(paste(capture.output(tools::Rd2txt(get(nm, envir = ha))), collapse = "\n"),
                   error = function(e) paste("ERR", conditionMessage(e)))
    tb <- tryCatch(paste(capture.output(tools::Rd2txt(get(nm, envir = hb))), collapse = "\n"),
                   error = function(e) paste("ERR", conditionMessage(e)))
    if (!identical(ta, tb)) txtdiffs <- c(txtdiffs, nm)
  }
  tot_topics <- tot_topics + length(topics); tot_diff <- tot_diff + length(diffs)
  cat(sprintf("%-10s topics=%-4d struct_diff_after_deep_strip=%-3d Rd2txt_render_diff=%-3d\n",
              p, length(topics), length(diffs), length(txtdiffs)))
  if (length(diffs)) cat("    STRUCT DIFF:", paste(utils::head(diffs, 10), collapse = ", "), "\n")
  if (length(txtdiffs)) cat("    RENDER DIFF:", paste(utils::head(txtdiffs, 10), collapse = ", "), "\n")
}
cat(sprintf("\nTOTAL: %d topics across 6 packages, %d structurally differing after stripping build paths\n",
            tot_topics, tot_diff))
sink()
