variable "name_prefix" {
  type        = string
  description = "Prefix for resource names, e.g. rag-platform-dev"
}

variable "cidr" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VPC CIDR block"
}

variable "az_count" {
  type        = number
  default     = 2
  description = "Number of availability zones to spread subnets across"
}

variable "cluster_name" {
  type        = string
  description = "EKS cluster name — added as a tag on subnets for cluster autodiscovery"
}
