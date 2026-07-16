output "cluster_name" {
  value       = aws_eks_cluster.this.name
  description = "EKS cluster name"
}

output "cluster_endpoint" {
  value       = aws_eks_cluster.this.endpoint
  description = "EKS cluster API endpoint"
}

output "cluster_certificate_authority_data" {
  value       = aws_eks_cluster.this.certificate_authority[0].data
  description = "Base64-encoded CA data for the cluster"
}

output "cluster_version" {
  value       = aws_eks_cluster.this.version
  description = "Kubernetes version running on the cluster"
}

output "oidc_provider_arn" {
  value       = aws_iam_openid_connect_provider.eks.arn
  description = "ARN of the OIDC provider — used by IRSA trust policies"
}

output "oidc_provider_url" {
  value       = replace(aws_iam_openid_connect_provider.eks.url, "https://", "")
  description = "OIDC provider URL without the https:// prefix — used in IRSA trust policy conditions"
}

output "node_role_arn" {
  value       = aws_iam_role.node.arn
  description = "IAM role ARN attached to worker nodes"
}
