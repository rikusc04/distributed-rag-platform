variable "name_prefix" {
  type        = string
  description = "Prefix for resource names, e.g. rag-platform-dev"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID the cache security group is created in"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnets for the cache subnet group"
}

variable "cluster_security_group_id" {
  type        = string
  description = "EKS cluster security group — only allowed source for Redis"
}

variable "node_type" {
  type        = string
  default     = "cache.t4g.micro"
  description = "ElastiCache node type"
}

variable "engine_version" {
  type        = string
  default     = "7.1"
  description = "Redis engine version"
}
