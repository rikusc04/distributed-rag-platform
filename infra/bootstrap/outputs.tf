output "state_bucket" {
  value       = aws_s3_bucket.tfstate.id
  description = "S3 bucket that holds Terraform state for all environments. State locking uses S3-native conditional writes (use_lockfile = true) — no DynamoDB table needed."
}

output "backend_config" {
  value       = <<-EOT
    terraform {
      backend "s3" {
        bucket       = "${aws_s3_bucket.tfstate.id}"
        key          = "<env>/terraform.tfstate"
        region       = "${var.region}"
        encrypt      = true
        use_lockfile = true
      }
    }
  EOT
  description = "Paste this backend block into each environment's main.tf, replacing <env> with dev/prod/etc."
}
