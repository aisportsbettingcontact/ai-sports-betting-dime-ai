#!/usr/bin/env Rscript
# Parse CRAN PACKAGES (DCF) indices -> package,version,md5sum triples.
# Uses read.dcf (the same parser R itself uses) rather than ad-hoc grep, so
# continuation lines / field wrapping cannot corrupt the extraction.
args <- commandArgs(trailingOnly = TRUE)
infile <- args[1]
outfile <- args[2]

d <- read.dcf(infile, fields = c("Package", "Version", "MD5sum", "Path"))
df <- data.frame(
  package = as.character(d[, "Package"]),
  version = as.character(d[, "Version"]),
  md5sum  = as.character(d[, "MD5sum"]),
  path    = as.character(d[, "Path"]),
  stringsAsFactors = FALSE
)
cat(sprintf("records=%d  na_md5=%d  na_version=%d  with_path=%d  dup_pkg=%d\n",
            nrow(df), sum(is.na(df$md5sum)), sum(is.na(df$version)),
            sum(!is.na(df$path)), sum(duplicated(df$package))))
write.csv(df, outfile, row.names = FALSE, na = "NA")
