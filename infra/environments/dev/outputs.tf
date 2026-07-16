output "cluster_name" {
  value       = module.eks.cluster_name
  description = "EKS cluster name. Feed to: aws eks update-kubeconfig --name <this>"
}

output "cluster_endpoint" {
  value       = module.eks.cluster_endpoint
  description = "EKS API server endpoint"
}

output "postgres_endpoint" {
  value       = module.rds.instance_endpoint
  description = "Postgres endpoint (host:port). Only reachable from inside the VPC (via EKS pods)."
}

output "postgres_db_name" {
  value       = module.rds.db_name
  description = "Initial database name"
}

output "postgres_secret_arn" {
  value       = module.rds.master_user_secret_arn
  description = "Secrets Manager ARN holding the DB master password"
}

output "redis_endpoint" {
  value       = module.elasticache.primary_endpoint_address
  description = "Redis primary endpoint hostname (use with TLS on port 6379)"
}

output "docs_bucket" {
  value       = module.s3_sqs.bucket_name
  description = "S3 bucket where clients upload documents"
}

output "ingest_queue_url" {
  value       = module.s3_sqs.queue_url
  description = "SQS queue URL that ingestion workers consume from"
}

output "ingest_queue_name" {
  value       = module.s3_sqs.queue_name
  description = "SQS queue name (used by the KEDA ScaledObject)"
}

output "ecr_repository_urls" {
  value       = module.ecr.repository_urls
  description = "Map of service name to ECR repository URL"
}

output "ingestion_worker_role_arn" {
  value       = module.iam.ingestion_worker_role_arn
  description = "IRSA role to annotate on the ingestion-worker ServiceAccount"
}

output "mcp_gateway_role_arn" {
  value       = module.iam.mcp_gateway_role_arn
  description = "IRSA role to annotate on the mcp-gateway ServiceAccount"
}
