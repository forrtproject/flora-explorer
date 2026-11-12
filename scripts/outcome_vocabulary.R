# Shared outcome vocabulary for the Mean Citedness summaries.
vocabulary <- fromJSON(file.path(root, "data", "outcome_vocabulary.json"), simplifyVector = FALSE)
classify_outcome <- function(x) {
  mapping <- unlist(lapply(vocabulary$replication, function(item) {
    setNames(rep(item$key, length(item$aliases)), unlist(item$aliases))
  }))
  # Match Python str.strip() and JS trim(), which also remove non-breaking and other Unicode spaces.
  values <- trimws(tolower(x), whitespace = "[\\h\\v]")
  result <- unname(mapping[values])
  result[is.na(result)] <- "unrecognised"
  result[is.na(values) | values %in% unlist(vocabulary$missing_markers)] <- "missing"
  result
}
