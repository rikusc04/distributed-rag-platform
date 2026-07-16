output "primary_endpoint_address" {
  value       = aws_elasticache_replication_group.cache.primary_endpoint_address
  description = "Redis primary endpoint hostname"
}

output "port" {
  value       = aws_elasticache_replication_group.cache.port
  description = "Redis port"
}

output "cache_security_group_id" {
  value       = aws_security_group.cache.id
  description = "Security group ID for the cache"
}
