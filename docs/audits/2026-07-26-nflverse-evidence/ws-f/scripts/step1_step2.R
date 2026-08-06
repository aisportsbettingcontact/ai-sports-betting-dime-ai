#!/usr/bin/env Rscript
# Task 6 (WS-F): API & schema inventory -- Steps 1 & 2.
# Step 1: full export inventory (getNamespaceExports + Rd_db titles + reexport detection) -> exports.csv
# Step 2: dump every nflreadr dictionary_* dataset -> dictionaries/<name>.csv
#
# Run: Rscript --vanilla step1_step2.R
# Reads only from LIB (read-only); writes only under $ROOT/evidence/ws-f/.

LIB <- "/opt/homebrew/lib/R/4.6/site-library"
ROOT <- "/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit"
OUT_DIR <- file.path(ROOT, "evidence", "ws-f")
DICT_DIR <- file.path(OUT_DIR, "dictionaries")
dir.create(DICT_DIR, recursive = TRUE, showWarnings = FALSE)

targets <- c("nflverse", "nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR")

notes <- character(0)
add_note <- function(...) notes <<- c(notes, paste0(...))

squeeze <- function(x) {
  if (is.null(x) || length(x) == 0) return("")
  x <- paste(as.character(x), collapse = " ")
  x <- gsub("[\r\n\t]+", " ", x)
  x <- gsub("\\s+", " ", x)
  trimws(x)
}

add_note("=== Step 1/2 run metadata ===")
add_note("R.version.string: ", R.version.string)
add_note("Sys.time(): ", format(Sys.time(), tz = "UTC", usetz = TRUE))
add_note(".libPaths() used: ", LIB)
add_note("")

# ---- Load all 6 target namespaces up front (no attach), from LIB explicitly ----
add_note("=== Package load + version check ===")
load_ok <- setNames(logical(length(targets)), targets)
for (pkg in targets) {
  ok <- tryCatch({
    requireNamespace(pkg, quietly = TRUE, lib.loc = LIB)
  }, error = function(e) FALSE)
  load_ok[pkg] <- isTRUE(ok)
  ver <- tryCatch(as.character(utils::packageVersion(pkg, lib.loc = LIB)), error = function(e) "NA")
  add_note(sprintf("%-10s loaded=%-5s version=%s", pkg, isTRUE(ok), ver))
  if (!isTRUE(ok)) add_note("GAP: failed to load namespace for ", pkg, " -- retried once, still failing")
}
add_note("")

# =========================================================================
# STEP 1: export inventory
# =========================================================================
rows <- vector("list", 0)
per_pkg_summary <- character(0)
missing_title_log <- character(0)
reexport_log <- character(0)
error_log <- character(0)

for (pkg in targets) {
  if (!isTRUE(load_ok[pkg])) {
    add_note("GAP: skipping export inventory for ", pkg, " (namespace failed to load)")
    next
  }

  ns_exports <- tryCatch(getNamespaceExports(pkg), error = function(e) {
    add_note("GAP: getNamespaceExports failed for ", pkg, ": ", conditionMessage(e))
    character(0)
  })
  ns_exports <- sort(ns_exports, method = "radix")

  # Build alias -> title map from every Rd file in the package (not just reexports.Rd),
  # since some packages document a reexported symbol under its own dedicated Rd
  # (e.g. nflplotR documents nflverse_sitrep.Rd separately from reexports.Rd).
  rd_db <- tryCatch(tools::Rd_db(pkg), error = function(e) {
    add_note("GAP: Rd_db failed for ", pkg, ": ", conditionMessage(e))
    list()
  })
  alias_title <- new.env()
  for (rd_name in names(rd_db)) {
    rd <- rd_db[[rd_name]]
    al <- tryCatch(tools:::.Rd_get_metadata(rd, "alias"), error = function(e) character(0))
    ti <- tryCatch(squeeze(tools:::.Rd_get_metadata(rd, "title")), error = function(e) "")
    for (a in al) assign(a, ti, envir = alias_title)
  }

  # Static hint: this package's own "reexports.Rd" topic (if any) lists aliases
  # of objects re-exported from elsewhere -- used as the second detection method
  # required by the brief ("via environment(get(sym)) namespace OR the pkg's reexports Rd").
  reexports_rd_aliases <- character(0)
  if ("reexports.Rd" %in% names(rd_db)) {
    reexports_rd_aliases <- tryCatch(tools:::.Rd_get_metadata(rd_db[["reexports.Rd"]], "alias"), error = function(e) character(0))
    reexports_rd_aliases <- setdiff(reexports_rd_aliases, "reexports")
  }

  n_function <- 0L; n_data <- 0L; n_reexport <- 0L; n_error <- 0L

  for (sym in ns_exports) {
    obj <- tryCatch(get(sym, envir = asNamespace(pkg)), error = function(e) e)
    if (inherits(obj, "error")) {
      error_log <- c(error_log, sprintf("%s::%s -> get() failed: %s", pkg, sym, conditionMessage(obj)))
      rows[[length(rows) + 1]] <- data.frame(
        package = pkg, symbol = sym, kind = "ERROR", signature = "", title = "",
        stringsAsFactors = FALSE
      )
      n_error <- n_error + 1L
      next
    }

    is_fn <- is.function(obj)

    # Reexport detection method A: environment(get(sym)) namespace differs from pkg.
    env_reexport <- FALSE
    src_pkg <- NA_character_
    if (is_fn) {
      envnm <- tryCatch(environmentName(environment(obj)), error = function(e) "")
      if (nzchar(envnm) && envnm != pkg && envnm %in% loadedNamespaces()) {
        env_reexport <- TRUE
        src_pkg <- envnm
      }
    }
    # Reexport detection method B: listed in this package's own reexports.Rd.
    rd_reexport <- sym %in% reexports_rd_aliases

    is_reexport <- env_reexport || rd_reexport
    if (is_reexport && is.na(src_pkg)) src_pkg <- "unknown(rd-only)"

    kind <- if (is_reexport) "reexport" else if (is_fn) "function" else "data"

    sig <- ""
    if (is_fn) {
      sig <- tryCatch(squeeze(deparse(args(obj))), error = function(e) {
        error_log <<- c(error_log, sprintf("%s::%s -> deparse(args()) failed: %s", pkg, sym, conditionMessage(e)))
        ""
      })
    }

    title <- if (exists(sym, envir = alias_title, inherits = FALSE)) get(sym, envir = alias_title) else ""
    if (!nzchar(title)) {
      missing_title_log <- c(missing_title_log, sprintf("%s::%s (kind=%s)", pkg, sym, kind))
    }

    if (is_reexport) {
      reexport_log <- c(reexport_log, sprintf("%s::%s <- %s", pkg, sym, src_pkg))
      n_reexport <- n_reexport + 1L
    } else if (is_fn) {
      n_function <- n_function + 1L
    } else {
      n_data <- n_data + 1L
    }

    rows[[length(rows) + 1]] <- data.frame(
      package = pkg, symbol = sym, kind = kind, signature = sig, title = title,
      stringsAsFactors = FALSE
    )
  }

  per_pkg_summary <- c(per_pkg_summary, sprintf(
    "%-10s total=%-4d function=%-4d data=%-4d reexport=%-4d error=%-4d",
    pkg, length(ns_exports), n_function, n_data, n_reexport, n_error
  ))
}

exports_df <- do.call(rbind, rows)
# Sort by package,symbol (radix = locale-independent byte order, deterministic).
exports_df <- exports_df[order(exports_df$package, exports_df$symbol, method = "radix"), ]
rownames(exports_df) <- NULL

exports_csv_path <- file.path(OUT_DIR, "exports.csv")
write.csv(exports_df, exports_csv_path, row.names = FALSE)

add_note("=== Step 1: export inventory (exports.csv) ===")
add_note("Total rows written: ", nrow(exports_df))
for (l in per_pkg_summary) add_note(l)
add_note("")
add_note("--- reexports detected (symbol <- source namespace) ---")
for (l in reexport_log) add_note(l)
add_note("")
add_note("--- exported symbols with NO Rd title match (title=\"\" in exports.csv) ---")
if (length(missing_title_log) == 0) {
  add_note("(none -- every exported symbol matched an Rd alias)")
} else {
  for (l in missing_title_log) add_note(l)
}
add_note("")
if (length(error_log) > 0) {
  add_note("--- GAP: symbol retrieval/signature errors ---")
  for (l in error_log) add_note(l)
  add_note("")
}

# =========================================================================
# STEP 2: dump every nflreadr dictionary_* dataset
# =========================================================================
add_note("=== Step 2: nflreadr dictionary_* dump ===")

data_listing <- tryCatch(data(package = "nflreadr")$results[, "Item"], error = function(e) {
  add_note("GAP: data(package=\"nflreadr\") failed: ", conditionMessage(e))
  character(0)
})
add_note("data(package=\"nflreadr\") total datasets listed: ", length(data_listing))
add_note("Full dataset listing: ", paste(sort(data_listing), collapse = ", "))
add_note("")

dict_names <- sort(grep("^dictionary_", data_listing, value = TRUE), method = "radix")
add_note("dictionary_* datasets found: ", length(dict_names))
add_note("")

dict_field_counts <- character(0)
for (nm in dict_names) {
  e <- new.env()
  ok <- tryCatch({
    data(list = nm, package = "nflreadr", envir = e)
    TRUE
  }, error = function(err) {
    add_note("GAP: data() load failed for ", nm, ": ", conditionMessage(err))
    FALSE
  })
  if (!ok || !exists(nm, envir = e)) next
  d <- get(nm, envir = e)
  out_path <- file.path(DICT_DIR, paste0(nm, ".csv"))
  write.csv(d, out_path, row.names = FALSE)
  dict_field_counts <- c(dict_field_counts, sprintf("%-28s nrow(fields)=%-4d ncol=%-2d colnames=%s",
                                                      nm, nrow(d), ncol(d), paste(colnames(d), collapse = "|")))
}
for (l in dict_field_counts) add_note(l)
add_note("")

# non-dictionary nflreadr datasets present but NOT part of the dictionary_* family (for completeness/notes only, not dumped as "dictionaries")
other_datasets <- sort(setdiff(data_listing, dict_names), method = "radix")
add_note("Other (non-dictionary_*) nflreadr datasets NOT dumped to dictionaries/ (out of Step-2 scope, listed for completeness): ", paste(other_datasets, collapse = ", "))
add_note("")

writeLines(notes, file.path(OUT_DIR, "notes-step1-step2.md"))

cat("DONE. exports.csv rows:", nrow(exports_df), "\n")
cat("DONE. dictionaries dumped:", length(dict_field_counts), "\n")
