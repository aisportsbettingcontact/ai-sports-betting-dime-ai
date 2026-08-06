#!/usr/bin/env Rscript
# Task 1 / WS-A / Step 3: Currency check.
#
# - available.packages(repos="https://cloud.r-project.org") for CRAN-current
#   versions of all 90 installed packages (derived fresh at run time, per
#   instructions -- Task 0's "all CRAN-current" note is NOT assumed here).
# - For the 6 nflverse targets, also fetch the upstream GitHub DESCRIPTION
#   (HEAD, falling back to main then master on non-200) via curl and record
#   its Version: as github_dev.
# - Writes currency.csv: package,installed,cran_current,status,github_dev
#   (github_dev non-empty only for the 6 targets).
#
# Run: Rscript --vanilla 03-currency.R

ROOT <- Sys.getenv("ROOT")
if (identical(ROOT, "")) stop("ROOT env var not set")

MANIFEST  <- file.path(ROOT, "evidence", "installed-manifest.csv")
OUT_CSV   <- file.path(ROOT, "evidence", "ws-a", "currency.csv")
LOG_FILE  <- file.path(ROOT, "evidence", "ws-a", "scripts", "03-currency.log")
GAPS_FILE <- file.path(ROOT, "evidence", "ws-a", "scripts", "03-currency-gaps.txt")

TARGETS <- c("nflverse", "nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR")

log_lines <- character(0)
gap_lines <- character(0)
logmsg <- function(...) {
  m <- sprintf(...)
  log_lines <<- c(log_lines, m)
  cat(m, "\n", sep = "")
}
gap <- function(...) {
  m <- sprintf(...)
  gap_lines <<- c(gap_lines, m)
  logmsg("GAP: %s", m)
}

manifest <- read.csv(MANIFEST, stringsAsFactors = FALSE)
stopifnot(all(c("package", "version") %in% names(manifest)))
stopifnot(nrow(manifest) == 90)
logmsg("Loaded manifest: %d rows", nrow(manifest))

# --- available.packages() against CRAN, with one retry on failure ---
fetch_available <- function() {
  available.packages(repos = "https://cloud.r-project.org", type = "source")
}
ap <- tryCatch(fetch_available(), error = function(e) NULL)
if (is.null(ap)) {
  logmsg("WARN: available.packages() failed on first attempt, retrying once")
  Sys.sleep(2)
  ap <- tryCatch(fetch_available(), error = function(e) NULL)
}
if (is.null(ap)) {
  gap("available.packages(repos=\"https://cloud.r-project.org\") failed after 1 retry -- cannot compute cran_current for ANY package")
  ap <- matrix(character(0), nrow = 0, ncol = 0, dimnames = list(character(0), character(0)))
} else {
  logmsg("available.packages() returned %d CRAN packages", nrow(ap))
}

cran_version_of <- function(pkg) {
  if (pkg %in% rownames(ap)) unname(ap[pkg, "Version"]) else NA_character_
}

# --- GitHub dev version fetch for the 6 targets, HEAD -> main -> master, curl, retry-once-per-ref ---
fetch_url_status <- function(url, out_file) {
  # returns HTTP status code (character) via curl -w; writes body to out_file
  res <- suppressWarnings(system2("curl", c("-s", "-o", out_file, "-w", "%{http_code}",
                                             "--max-time", "20", url), stdout = TRUE, stderr = TRUE))
  if (length(res) == 0) return("000")
  res[length(res)]
}

fetch_github_version <- function(pkg) {
  refs <- c("HEAD", "main", "master")
  for (ref in refs) {
    url <- sprintf("https://raw.githubusercontent.com/nflverse/%s/%s/DESCRIPTION", pkg, ref)
    tmp <- tempfile()
    status <- fetch_url_status(url, tmp)
    if (identical(status, "200")) {
      logmsg("  %s: ref=%s -> 200", pkg, ref)
      txt <- readLines(tmp, warn = FALSE)
      ver_line <- grep("^Version:", txt, value = TRUE)
      unlink(tmp)
      if (length(ver_line) > 0) {
        v <- trimws(sub("^Version:", "", ver_line[1]))
        return(v)
      } else {
        logmsg("  %s: ref=%s -> 200 but no Version: line found in DESCRIPTION", pkg, ref)
        next
      }
    } else {
      logmsg("  %s: ref=%s -> status=%s", pkg, ref, status)
    }
    unlink(tmp)
  }
  # all three refs failed on first pass -- retry the whole ref sequence once (evidence-first: retry once)
  logmsg("  %s: HEAD/main/master all failed on first pass, retrying full sequence once", pkg)
  for (ref in refs) {
    url <- sprintf("https://raw.githubusercontent.com/nflverse/%s/%s/DESCRIPTION", pkg, ref)
    tmp <- tempfile()
    status <- fetch_url_status(url, tmp)
    if (identical(status, "200")) {
      txt <- readLines(tmp, warn = FALSE)
      ver_line <- grep("^Version:", txt, value = TRUE)
      unlink(tmp)
      if (length(ver_line) > 0) {
        v <- trimws(sub("^Version:", "", ver_line[1]))
        logmsg("  %s: retry ref=%s -> 200, Version=%s", pkg, ref, v)
        return(v)
      }
    }
    unlink(tmp)
  }
  gap(sprintf("GitHub DESCRIPTION fetch failed for nflverse/%s on all of HEAD/main/master, after 1 retry of the full sequence", pkg))
  NA_character_
}

github_dev_of <- setNames(rep(NA_character_, length(TARGETS)), TARGETS)
logmsg("Fetching GitHub dev versions for the 6 targets...")
for (pkg in TARGETS) {
  github_dev_of[pkg] <- fetch_github_version(pkg)
}

# --- Build currency.csv ---
status_of <- function(installed_v, cran_v) {
  if (is.na(cran_v)) return("archived-or-missing")
  iv <- tryCatch(package_version(installed_v), error = function(e) NULL)
  cv <- tryCatch(package_version(cran_v), error = function(e) NULL)
  if (is.null(iv) || is.null(cv)) return("archived-or-missing")
  if (iv < cv) return("outdated")
  "current"
}

pkgs <- sort(manifest$package)
out <- data.frame(
  package = character(0), installed = character(0), cran_current = character(0),
  status = character(0), github_dev = character(0), stringsAsFactors = FALSE
)

for (pkg in pkgs) {
  installed_v <- manifest$version[manifest$package == pkg][1]
  cran_v <- cran_version_of(pkg)
  st <- status_of(installed_v, cran_v)
  gd <- if (pkg %in% TARGETS) {
    v <- github_dev_of[[pkg]]
    if (is.na(v)) "" else v
  } else {
    ""
  }
  out <- rbind(out, data.frame(package = pkg, installed = installed_v,
                                cran_current = ifelse(is.na(cran_v), "", cran_v),
                                status = st, github_dev = gd, stringsAsFactors = FALSE))
}

stopifnot(nrow(out) == 90)
stopifnot(length(unique(out$package)) == 90)
# github_dev must be non-empty only for the 6 targets (unless a GH fetch gap occurred, in which case
# it's legitimately empty for a target too -- checked separately below and reported as a gap, not silently)
non_target_with_gd <- out$package[!(out$package %in% TARGETS) & nzchar(out$github_dev)]
stopifnot(length(non_target_with_gd) == 0)

write.table(out, OUT_CSV, sep = ",", row.names = FALSE,
            col.names = c("package", "installed", "cran_current", "status", "github_dev"),
            quote = FALSE)

logmsg("Wrote %d rows to %s", nrow(out), OUT_CSV)
logmsg("Status breakdown: %s", paste(capture.output(print(table(out$status))), collapse = " | "))
targets_missing_gd <- TARGETS[is.na(github_dev_of) | !nzchar(ifelse(is.na(github_dev_of), "", github_dev_of))]
if (length(targets_missing_gd) > 0) {
  logmsg("Targets with NO github_dev recorded (see gaps file): %s", paste(targets_missing_gd, collapse = ", "))
}

writeLines(log_lines, LOG_FILE)
if (length(gap_lines) > 0) {
  writeLines(gap_lines, GAPS_FILE)
} else if (file.exists(GAPS_FILE)) {
  file.remove(GAPS_FILE)
}
cat(sprintf("GAPS recorded: %d (see %s)\n", length(gap_lines), GAPS_FILE))
