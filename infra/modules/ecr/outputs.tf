output "repository_urls" {
  value       = { for name, repo in aws_ecr_repository.this : name => repo.repository_url }
  description = "Map of service name to fully-qualified ECR URL"
}

output "repository_arns" {
  value       = { for name, repo in aws_ecr_repository.this : name => repo.arn }
  description = "Map of service name to ECR repository ARN"
}
