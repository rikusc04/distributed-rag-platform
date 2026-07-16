resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name_prefix}-cache-subnets"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "${var.name_prefix}-cache-subnets"
  }
}

resource "aws_security_group" "cache" {
  name        = "${var.name_prefix}-cache-sg"
  description = "Redis ingress from EKS cluster only"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-cache-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "cache_from_cluster" {
  security_group_id            = aws_security_group.cache.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  referenced_security_group_id = var.cluster_security_group_id
  description                  = "Redis from EKS cluster security group"
}

resource "aws_elasticache_replication_group" "cache" {
  replication_group_id = "${var.name_prefix}-cache"
  description          = "Semantic response cache for MCP gateway"

  engine               = "redis"
  engine_version       = var.engine_version
  parameter_group_name = "default.redis7"
  node_type            = var.node_type
  port                 = 6379

  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.cache.id]

  apply_immediately = true

  tags = {
    Name = "${var.name_prefix}-cache"
  }
}
