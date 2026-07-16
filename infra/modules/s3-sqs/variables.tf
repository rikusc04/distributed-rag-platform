variable "name_prefix" {
  type        = string
  description = "Prefix for bucket/queue names, e.g. rag-platform-dev"
}

variable "account_id" {
  type        = string
  description = "AWS account ID — appended to bucket name to ensure global uniqueness"
}
