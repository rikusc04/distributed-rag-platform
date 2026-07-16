variable "name_prefix" {
  type        = string
  description = "Prefix for resource names, e.g. rag-platform-dev"
}

variable "oidc_provider_arn" {
  type        = string
  description = "ARN of the EKS OIDC provider (from eks module)"
}

variable "oidc_provider_url" {
  type        = string
  description = "OIDC provider URL WITHOUT https:// (from eks module)"
}

variable "ingestion_sqs_queue_arn" {
  type        = string
  description = "ARN of the SQS queue ingestion workers consume from"
}

variable "ingestion_docs_bucket_arn" {
  type        = string
  description = "ARN of the S3 docs bucket ingestion workers read from"
}

variable "db_master_user_secret_arn" {
  type        = string
  description = "ARN of the Secrets Manager secret holding the DB master password"
}

variable "service_account_namespace" {
  type        = string
  default     = "rag-platform"
  description = "K8s namespace where both service accounts live"
}

variable "ingestion_worker_sa_name" {
  type        = string
  default     = "ingestion-worker"
  description = "K8s ServiceAccount name for the ingestion worker"
}

variable "mcp_gateway_sa_name" {
  type        = string
  default     = "mcp-gateway"
  description = "K8s ServiceAccount name for the MCP gateway"
}
