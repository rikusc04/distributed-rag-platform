output "instance_endpoint" {
  value       = aws_db_instance.this.endpoint
  description = "Postgres endpoint (host:port)"
}

output "instance_address" {
  value       = aws_db_instance.this.address
  description = "Postgres hostname without port"
}

output "instance_port" {
  value       = aws_db_instance.this.port
  description = "Postgres port"
}

output "db_name" {
  value       = aws_db_instance.this.db_name
  description = "Initial database name"
}

output "master_user_secret_arn" {
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
  description = "Secrets Manager ARN holding the master password (managed by RDS)"
}

output "db_security_group_id" {
  value       = aws_security_group.db.id
  description = "Security group ID guarding the DB"
}
