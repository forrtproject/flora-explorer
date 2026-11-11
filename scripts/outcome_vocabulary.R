# Shared outcome vocabulary for the Mean Citedness summaries.
vocabulary <- fromJSON(file.path(root, "data", "outcome_vocabulary.json"), simplifyVector = FALSE)
classify_outcome <- function(x) {
  mapping <- unlist(lapply(vocabulary$replication, function(item) {
    setNames(rep(item$key, length(item$aliases)), unlist(item$aliases))
  }))
  values <- trimws(tolower(x))
  result <- unname(mapping[values])
  result[is.na(result)] <- "unrecognised"
  result[is.na(values) | values %in% unlist(vocabulary$missing_markers)] <- "missing"
  result
}
