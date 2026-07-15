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
  # backend "s3" { ... }  # configure once bootstrap bucket exists
}

provider "aws" {
  region = var.region
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
