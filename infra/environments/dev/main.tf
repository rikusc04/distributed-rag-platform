# Dev environment root. Wires modules from ../../modules into a single environment.

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

module "rds" {
  source                    = "../../modules/rds"
  name_prefix               = local.name_prefix
  vpc_id                    = module.vpc.vpc_id
  private_subnet_ids        = module.vpc.private_subnet_ids
  cluster_security_group_id = module.eks.cluster_security_group_id
}

module "elasticache" {
  source                    = "../../modules/elasticache"
  name_prefix               = local.name_prefix
  vpc_id                    = module.vpc.vpc_id
  private_subnet_ids        = module.vpc.private_subnet_ids
  cluster_security_group_id = module.eks.cluster_security_group_id
}

module "iam" {
  source                    = "../../modules/iam"
  name_prefix               = local.name_prefix
  oidc_provider_arn         = module.eks.oidc_provider_arn
  oidc_provider_url         = module.eks.oidc_provider_url
  ingestion_sqs_queue_arn   = module.s3_sqs.queue_arn
  ingestion_docs_bucket_arn = module.s3_sqs.bucket_arn
  db_master_user_secret_arn = module.rds.master_user_secret_arn
}
