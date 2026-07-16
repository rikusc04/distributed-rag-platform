variable "name_prefix" {
  type        = string
  description = "Prefix for repository names, e.g. rag-platform-dev"
}

variable "repositories" {
  type        = list(string)
  default     = ["ingestion-worker", "mcp-gateway"]
  description = "Service names — each gets its own repo at <name_prefix>/<service>"
}
