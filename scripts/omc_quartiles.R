#!/usr/bin/env Rscript
# Q1, Q3 and the upper fence Q3 + 3 * IQR of log(OMC + 1), the GAM's predictor,
# over all replications with an OMC (the outlier cutoff in render_impact_factor.R).

args     <- commandArgs(trailingOnly = FALSE)
file_arg <- sub("^--file=", "", grep("^--file=", args, value = TRUE))
root <- if (length(file_arg) > 0) normalizePath(file.path(dirname(file_arg[[1]]), "..")) else getwd()

raw <- read.csv(file.path(root, "data", "flora_with_omc.csv"),
                stringsAsFactors = FALSE, na.strings = c("", "NA"))
raw$impact_factor <- suppressWarnings(as.numeric(raw$impact_factor))

type_lc        <- tolower(raw$type)
is_replication <- grepl("replication", type_lc) & !grepl("reproduc", type_lc)

df <- raw[!is.na(raw$impact_factor) & is_replication, ]
df$omc_log <- log(df$impact_factor + 1)

q     <- quantile(df$omc_log, c(0.25, 0.75), names = FALSE)
fence <- q[2] + 3 * (q[2] - q[1])

print(data.frame(
  n           = nrow(df),
  q1_log      = round(q[1], 4),
  q3_log      = round(q[2], 4),
  iqr_log     = round(q[2] - q[1], 4),
  fence_log   = round(fence, 4),
  fence_omc   = round(expm1(fence), 3),
  n_above     = sum(df$omc_log > fence)
), row.names = FALSE)
