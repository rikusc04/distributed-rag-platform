# Dev environment root — wires together modules from ../../modules.
# Week 1: implement VPC → EKS → RDS → ElastiCache → S3/SQS → ECR → IAM/IRSA.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
  backend "s3" {
    bucket       = "rag-platform-tfstate-997985548040"
    key          = "dev/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "rag-platform"
}

variable "environment" {
  type    = string
  default = "dev"
}

locals {
  name_prefix  = "${var.project}-${var.environment}"
  cluster_name = "${var.project}-${var.environment}"
}

module "vpc" {
  source       = "../../modules/vpc"
  name_prefix  = local.name_prefix
  cluster_name = local.cluster_name
}
