#!/usr/bin/env Rscript
# Compute the Mean Citedness analysis and write chart-ready JSON for the
# FLoRA Explorer frontend. No Rmd/pandoc needed — all rendering is done
# client-side with Chart.js.
#
# Outputs:
#   data/impact_factor_data.json   — histogram + GAM curve + overview stats
#   data/impact_factor_meta.json   — { last_updated, n_rows_with_omc, source }

suppressPackageStartupMessages({
  library(jsonlite)
  library(mgcv)
})

# Resolve project root
args     <- commandArgs(trailingOnly = FALSE)
file_arg <- sub("^--file=", "", grep("^--file=", args, value = TRUE))
if (length(file_arg) > 0) {
  root <- normalizePath(file.path(dirname(file_arg[[1]]), ".."), mustWork = FALSE)
} else {
  root <- normalizePath(getwd(), mustWork = FALSE)
  if (basename(root) == "scripts") root <- dirname(root)
}

data_csv  <- file.path(root, "data", "flora_with_omc.csv")
disc_json <- file.path(root, "data", "disciplines.json")
out_data  <- file.path(root, "data", "impact_factor_data.json")
out_meta  <- file.path(root, "data", "impact_factor_meta.json")

if (!file.exists(data_csv)) stop("flora_with_omc.csv not found at ", data_csv)

# ── Outcome classifier ───────────────────────────────────────────────────────
# Read the same category aliases as JavaScript and Python. Binary eligibility below
# remains limited to unqualified successful/failed reference pairs.
source(file.path(root, "scripts", "outcome_vocabulary.R"))

# ── Load & enrich ────────────────────────────────────────────────────────────
raw <- read.csv(data_csv, stringsAsFactors = FALSE, na.strings = c("", "NA"))

DISCIPLINES <- fromJSON(disc_json, simplifyVector = FALSE)
normalize <- function(x) {
  x <- tolower(x)
  x <- gsub("[^a-z0-9 ]", " ", x)
  x <- gsub("\\s+", " ", x)
  trimws(x)
}
lookup <- do.call(rbind, lapply(names(DISCIPLINES), function(disc) {
  data.frame(journal_norm = normalize(unlist(DISCIPLINES[[disc]])),
             discipline   = disc, stringsAsFactors = FALSE)
}))
raw$journal_norm <- normalize(raw$journal_o)
raw$discipline   <- lookup$discipline[match(raw$journal_norm, lookup$journal_norm)]
raw$discipline   <- ifelse(is.na(raw$discipline), "Uncategorized", raw$discipline)

raw$impact_factor <- suppressWarnings(as.numeric(raw$impact_factor))

# This analysis is replications only - reproductions are coded on different dimensions
# (computational/robustness, not successful/failed/mixed) and are handled separately by
# compute_omc.py's compute_reproduction_impact_stats(), written to
# data/impact_factor_reproductions.json. Without this filter, reproduction rows silently
# inflated n_total/n_journals/n_disciplines here (their outcome text never matched
# "successful"/"failed"/etc, so they never affected the outcome counts, but were still
# counted as rows).
raw$type_lc     <- tolower(raw$type)
is_reproduction <- grepl("reproduc", raw$type_lc)
is_replication  <- grepl("replication", raw$type_lc) & !is_reproduction

df_before_outliers <- raw[!is.na(raw$impact_factor) & is_replication, ]

# Drop extreme OMC outliers: above Q3 + 3 * IQR of log(OMC + 1), the model scale.
omc_log   <- log(df_before_outliers$impact_factor + 1)
omc_q     <- quantile(omc_log, c(0.25, 0.75), names = FALSE)
fence_log <- omc_q[2] + 3 * (omc_q[2] - omc_q[1])
outlier_fence <- list(q1_log     = round(omc_q[1], 4),
                      q3_log     = round(omc_q[2], 4),
                      fence_log  = round(fence_log, 4),
                      fence_omc  = round(expm1(fence_log), 3),
                      n_outliers = sum(omc_log > fence_log))

df_all  <- df_before_outliers[omc_log <= fence_log, ]
# Replications are classified from their own column; compute_omc.py fills it from the
# combined `outcome` until FLoRA ships it.
df_all$outcome_class <- classify_outcome(df_all$outcome_replication)
oc_all <- df_all$outcome_class

# ── Overview stats ───────────────────────────────────────────────────────────
overview <- list(
  n_total       = nrow(df_all),
  n_input       = sum(is_replication),
  n_excluded    = sum(is_replication) - nrow(df_all),
  n_classified  = sum(oc_all %in% c("successful", "failed", "mixed")),
  n_success     = sum(oc_all == "successful"),
  n_failed      = sum(oc_all == "failed"),
  n_mixed       = sum(oc_all == "mixed"),
  n_qualified = sum(oc_all == "qualified"),
  n_descriptive = sum(oc_all == "descriptive"),
  n_uninformative = sum(oc_all == "uninformative"),
  n_missing = sum(oc_all == "missing"),
  n_unrecognised = sum(oc_all == "unrecognised"),
  n_journals    = length(unique(df_all$journal_o[!is.na(df_all$journal_o) &
                                                   nchar(df_all$journal_o) > 0])),
  n_disciplines = length(unique(df_all$discipline[df_all$discipline != "Uncategorized"]))
)

# ── Histogram data (bin width 0.5, 0 to just past the largest kept OMC) ──────
breaks    <- seq(0, floor(max(df_all$impact_factor) / 0.5) * 0.5 + 0.5, by = 0.5)
hist_data <- lapply(seq_len(length(breaks) - 1), function(i) {
  lo <- breaks[i]; hi <- breaks[i + 1]
  sub <- df_all[df_all$impact_factor >= lo & df_all$impact_factor < hi, ]
  oc  <- sub$outcome_class
  list(bin_lo     = lo,
       bin_hi     = hi,
       successful = sum(oc == "successful"),
       failed     = sum(oc == "failed"),
       mixed      = sum(oc == "mixed"),
       qualified = sum(oc == "qualified"), descriptive = sum(oc == "descriptive"),
       uninformative = sum(oc == "uninformative"), missing = sum(oc == "missing"),
       unrecognised = sum(oc == "unrecognised"))
})

# ── GAM model ────────────────────────────────────────────────────────────────
df  <- df_all[oc_all %in% c("successful", "failed"), ]
df$outcome_binary <- ifelse(df$outcome_class == "failed", 0L, 1L)
df$omc_log        <- log(df$impact_factor + 1)

stats_out <- list(edf = NA, chi_sq = NA, p_val = NA, r2 = NA, n_model = nrow(df))
gam_curve <- list()
jitter    <- list()

set.seed(20260913)
if (nrow(df) >= 30) {
  gam_fit <- tryCatch(
    gam(outcome_binary ~ s(omc_log), family = binomial, data = df),
    error = function(e) NULL
  )
  if (!is.null(gam_fit)) {
    gam_sum <- summary(gam_fit)
    null_ll <- as.numeric(logLik(glm(outcome_binary ~ 1,
                                     family = binomial, data = df)))
    stats_out <- list(
      edf     = round(gam_sum$edf,    3),
      chi_sq  = round(gam_sum$chi.sq, 3),
      p_val   = round(gam_sum$s.pv,   4),
      r2      = round(as.numeric(1 - logLik(gam_fit) / null_ll), 4),
      n_model = nrow(df)
    )

    omc_seq <- seq(min(df$impact_factor), max(df$impact_factor), length.out = 150)
    pred_df <- data.frame(omc_log = log(omc_seq + 1))
    gp      <- predict(gam_fit, newdata = pred_df, type = "link", se.fit = TRUE)
    gam_curve <- lapply(seq_along(omc_seq), function(i) list(
      omc  = round(omc_seq[i], 4),
      p    = round(plogis(gp$fit[i]), 4),
      p_lo = round(plogis(gp$fit[i] - 1.96 * gp$se.fit[i]), 4),
      p_hi = round(plogis(gp$fit[i] + 1.96 * gp$se.fit[i]), 4)
    ))

    jdf <- df[, c("impact_factor", "outcome_binary")]
    if (nrow(jdf) > 800) jdf <- jdf[sample(nrow(jdf), 800), ]
    jitter <- lapply(seq_len(nrow(jdf)), function(i)
      list(omc = round(jdf$impact_factor[i], 3), outcome = jdf$outcome_binary[i]))
  }
}

# ── Write outputs ─────────────────────────────────────────────────────────────
# jsonlite serialises list() as {} not [] — use numeric(0) for empty arrays
if (length(gam_curve) == 0) gam_curve <- numeric(0)
if (length(jitter)    == 0) jitter    <- numeric(0)

result <- list(overview  = overview,
               outlier_fence = outlier_fence,
               stats     = stats_out,
               histogram = hist_data,
               gam_curve = gam_curve,
               jitter    = jitter)

writeLines(toJSON(result, auto_unbox = TRUE, pretty = FALSE), out_data)

meta <- list(
  last_updated    = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  n_rows_with_omc = overview$n_total,
  input_snapshot = fromJSON(file.path(root, "data", "flora_with_omc_meta.json"))$last_updated,
  source          = "scripts/render_impact_factor.R"
)
writeLines(toJSON(meta, auto_unbox = TRUE, pretty = TRUE), out_meta)

cat("✔ Wrote", out_data, "\n")
cat("✔ Wrote", out_meta, "\n")
