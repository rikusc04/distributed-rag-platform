variable "region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region for the state backend"
}

variable "project" {
  type        = string
  default     = "rag-platform"
  description = "Project prefix for state bucket and lock table names"
}
