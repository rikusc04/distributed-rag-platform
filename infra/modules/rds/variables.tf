variable "name_prefix" {
  type        = string
  description = "Prefix for resource names, e.g. rag-platform-dev"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID the DB security group is created in"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnets for the DB subnet group (needs ≥2 AZs)"
}

variable "cluster_security_group_id" {
  type        = string
  description = "EKS cluster security group — the only source allowed ingress on 5432"
}

variable "engine_version" {
  type        = string
  default     = "16.6"
  description = "PostgreSQL major.minor version. pgvector is available on 15+; keep on 16.x"
}

variable "instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "RDS instance class"
}

variable "allocated_storage" {
  type        = number
  default     = 20
  description = "Initial storage size in GB"
}

variable "max_allocated_storage" {
  type        = number
  default     = 100
  description = "Storage autoscaling upper bound in GB"
}

variable "db_name" {
  type        = string
  default     = "ragplatform"
  description = "Initial database name"
}

variable "master_username" {
  type        = string
  default     = "app_admin"
  description = "Master DB username"
}
