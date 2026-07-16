# Dev environment root — wires together modules from ../../modules.
# Week 1: implement VPC → EKS → RDS → ElastiCache → S3/SQS → ECR → IAM/IRSA.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
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

data "aws_caller_identity" "current" {}

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

module "eks" {
  source             = "../../modules/eks"
  cluster_name       = local.cluster_name
  private_subnet_ids = module.vpc.private_subnet_ids
  public_subnet_ids  = module.vpc.public_subnet_ids
}

module "ecr" {
  source      = "../../modules/ecr"
  name_prefix = local.name_prefix
}

module "s3_sqs" {
  source      = "../../modules/s3-sqs"
  name_prefix = local.name_prefix
  account_id  = data.aws_caller_identity.current.account_id
}
