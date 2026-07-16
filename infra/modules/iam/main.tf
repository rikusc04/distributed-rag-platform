# IRSA workload roles, one per service. Each K8s ServiceAccount that
# annotates eks.amazonaws.com/role-arn = <one of the ARNs below> gets to
# assume its role.
#
# Both roles share the same trust-policy shape (only the SA name differs),
# so we drive everything off a single `local.roles` map and let for_each
# stamp the four resources per key.

locals {
  roles = {
    "ingestion-worker" = {
      namespace = var.service_account_namespace
      sa_name   = var.ingestion_worker_sa_name
      statements = [
        {
          sid       = "SqsConsume"
          actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
          resources = [var.ingestion_sqs_queue_arn]
        },
        {
          sid       = "S3ReadDocs"
          actions   = ["s3:GetObject"]
          resources = ["${var.ingestion_docs_bucket_arn}/*"]
        },
        {
          sid       = "SecretsRead"
          actions   = ["secretsmanager:GetSecretValue"]
          resources = [var.db_master_user_secret_arn]
        },
      ]
    }
    "mcp-gateway" = {
      namespace = var.service_account_namespace
      sa_name   = var.mcp_gateway_sa_name
      statements = [
        {
          sid       = "SecretsRead"
          actions   = ["secretsmanager:GetSecretValue"]
          resources = [var.db_master_user_secret_arn]
        },
      ]
    }
    # KEDA operator lives in its own namespace (from the upstream Helm chart)
    # and only needs to read the ingest queue's depth to drive the scaler.
    "keda-operator" = {
      namespace = "keda"
      sa_name   = "keda-operator"
      statements = [
        {
          sid       = "SqsReadDepth"
          actions   = ["sqs:GetQueueAttributes"]
          resources = [var.ingestion_sqs_queue_arn]
        },
      ]
    }
  }
}

data "aws_iam_policy_document" "trust" {
  for_each = local.roles

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
      values   = ["system:serviceaccount:${each.value.namespace}:${each.value.sa_name}"]
    }
  }
}

resource "aws_iam_role" "workload" {
  for_each = local.roles

  name               = "${var.name_prefix}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.trust[each.key].json

  tags = {
    Name = "${var.name_prefix}-${each.key}"
  }
}

data "aws_iam_policy_document" "workload" {
  for_each = local.roles

  dynamic "statement" {
    for_each = each.value.statements
    content {
      sid       = statement.value.sid
      effect    = "Allow"
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_policy" "workload" {
  for_each = local.roles

  name   = "${var.name_prefix}-${each.key}"
  policy = data.aws_iam_policy_document.workload[each.key].json
}

resource "aws_iam_role_policy_attachment" "workload" {
  for_each = local.roles

  role       = aws_iam_role.workload[each.key].name
  policy_arn = aws_iam_policy.workload[each.key].arn
}
