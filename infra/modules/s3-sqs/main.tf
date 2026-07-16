resource "aws_s3_bucket" "docs" {
  bucket = "${var.name_prefix}-docs-${var.account_id}"

  tags = {
    Name = "${var.name_prefix}-docs"
  }
}

resource "aws_s3_bucket_versioning" "docs" {
  bucket = aws_s3_bucket.docs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "docs" {
  bucket = aws_s3_bucket.docs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "docs" {
  bucket                  = aws_s3_bucket.docs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_sqs_queue" "ingest_dlq" {
  name                       = "${var.name_prefix}-ingest-dlq"
  message_retention_seconds  = 1209600 # 14 days
  visibility_timeout_seconds = 300

  tags = {
    Name = "${var.name_prefix}-ingest-dlq"
  }
}

resource "aws_sqs_queue" "ingest" {
  name                       = "${var.name_prefix}-ingest"
  visibility_timeout_seconds = 300    # 5 min — worker has this long to finish before message reappears
  message_retention_seconds  = 345600 # 4 days
  receive_wait_time_seconds  = 20     # long polling

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ingest_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name = "${var.name_prefix}-ingest"
  }
}

data "aws_iam_policy_document" "queue_from_s3" {
  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.ingest.arn]

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.docs.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "ingest" {
  queue_url = aws_sqs_queue.ingest.id
  policy    = data.aws_iam_policy_document.queue_from_s3.json
}

resource "aws_s3_bucket_notification" "docs" {
  bucket = aws_s3_bucket.docs.id

  queue {
    queue_arn = aws_sqs_queue.ingest.arn
    events    = ["s3:ObjectCreated:*"]
  }

  depends_on = [aws_sqs_queue_policy.ingest]
}
