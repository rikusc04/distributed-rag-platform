variable "cluster_name" {
  type        = string
  description = "Name of the EKS cluster"
}

variable "kubernetes_version" {
  type        = string
  default     = "1.31"
  description = "Kubernetes minor version for the control plane"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs where worker nodes will run"
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnet IDs (attached to cluster for load-balancer provisioning)"
}

variable "node_instance_types" {
  type        = list(string)
  default     = ["t3.medium"]
  description = "EC2 instance types for the default managed node group"
}

variable "node_desired_size" {
  type        = number
  default     = 2
  description = "Desired number of worker nodes"
}

variable "node_min_size" {
  type        = number
  default     = 1
  description = "Minimum number of worker nodes"
}

variable "node_max_size" {
  type        = number
  default     = 4
  description = "Maximum number of worker nodes"
}
