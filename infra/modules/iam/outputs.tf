output "ingestion_worker_role_arn" {
  value       = aws_iam_role.workload["ingestion-worker"].arn
  description = "IRSA role ARN to annotate on the ingestion-worker ServiceAccount"
}

output "mcp_gateway_role_arn" {
  value       = aws_iam_role.workload["mcp-gateway"].arn
  description = "IRSA role ARN to annotate on the mcp-gateway ServiceAccount"
}

output "keda_operator_role_arn" {
  value       = aws_iam_role.workload["keda-operator"].arn
  description = "IRSA role ARN to annotate on the keda-operator ServiceAccount (namespace: keda)"
}

output "service_account_namespace" {
  value       = var.service_account_namespace
  description = "Namespace both ServiceAccounts must be created in"
}
