# IRSA workload roles. Each K8s ServiceAccount that annotates
# eks.amazonaws.com/role-arn = <one of the ARNs below> gets to assume that role.

data "aws_iam_policy_document" "ingestion_worker_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:${var.service_account_namespace}:${var.ingestion_worker_sa_name}"]
    }
  }
}

resource "aws_iam_role" "ingestion_worker" {
  name               = "${var.name_prefix}-ingestion-worker"
  assume_role_policy = data.aws_iam_policy_document.ingestion_worker_trust.json

  tags = {
    Name = "${var.name_prefix}-ingestion-worker"
  }
}

data "aws_iam_policy_document" "ingestion_worker" {
  statement {
    sid    = "SqsConsume"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
    ]
    resources = [var.ingestion_sqs_queue_arn]
  }

  statement {
    sid       = "S3ReadDocs"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${var.ingestion_docs_bucket_arn}/*"]
  }

  statement {
    sid       = "SecretsRead"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.db_master_user_secret_arn]
  }
}

resource "aws_iam_policy" "ingestion_worker" {
  name   = "${var.name_prefix}-ingestion-worker"
  policy = data.aws_iam_policy_document.ingestion_worker.json
}

resource "aws_iam_role_policy_attachment" "ingestion_worker" {
  role       = aws_iam_role.ingestion_worker.name
  policy_arn = aws_iam_policy.ingestion_worker.arn
}

data "aws_iam_policy_document" "mcp_gateway_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:${var.service_account_namespace}:${var.mcp_gateway_sa_name}"]
    }
  }
}

resource "aws_iam_role" "mcp_gateway" {
  name               = "${var.name_prefix}-mcp-gateway"
  assume_role_policy = data.aws_iam_policy_document.mcp_gateway_trust.json

  tags = {
    Name = "${var.name_prefix}-mcp-gateway"
  }
}

data "aws_iam_policy_document" "mcp_gateway" {
  statement {
    sid       = "SecretsRead"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.db_master_user_secret_arn]
  }
}

resource "aws_iam_policy" "mcp_gateway" {
  name   = "${var.name_prefix}-mcp-gateway"
  policy = data.aws_iam_policy_document.mcp_gateway.json
}

resource "aws_iam_role_policy_attachment" "mcp_gateway" {
  role       = aws_iam_role.mcp_gateway.name
  policy_arn = aws_iam_policy.mcp_gateway.arn
}
