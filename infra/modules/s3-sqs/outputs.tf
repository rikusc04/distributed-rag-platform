output "bucket_name" {
  value       = aws_s3_bucket.docs.id
  description = "S3 bucket where users upload documents"
}

output "bucket_arn" {
  value       = aws_s3_bucket.docs.arn
  description = "ARN of the docs bucket"
}

output "queue_url" {
  value       = aws_sqs_queue.ingest.id
  description = "URL of the ingest SQS queue"
}

output "queue_arn" {
  value       = aws_sqs_queue.ingest.arn
  description = "ARN of the ingest SQS queue"
}

output "queue_name" {
  value       = aws_sqs_queue.ingest.name
  description = "Name of the ingest queue (used by KEDA scaler)"
}

output "dlq_url" {
  value       = aws_sqs_queue.ingest_dlq.id
  description = "URL of the ingest dead-letter queue"
}

output "dlq_arn" {
  value       = aws_sqs_queue.ingest_dlq.arn
  description = "ARN of the ingest DLQ"
}
