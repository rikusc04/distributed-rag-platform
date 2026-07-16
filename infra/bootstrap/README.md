# Bootstrap

One-time setup of the Terraform state backend: an S3 bucket (versioned, encrypted, private) for state files. State locking uses S3-native conditional writes (`use_lockfile = true`) — no separate DynamoDB table.

Runs with **local state** — this is the config that provisions the shared backend, so it can't use it.

## Apply

```
cd infra/bootstrap
terraform init
terraform apply
```

## Outputs

- `state_bucket`   — `rag-platform-tfstate-<account_id>`
- `backend_config` — a ready-to-paste backend block for env configs

## Notes

- The bucket has `prevent_destroy = true` — you cannot accidentally `terraform destroy` it. Remove that line and re-apply if you ever need to tear the whole thing down.
- Bootstrap state stays local (in `terraform.tfstate` next to this README). It's gitignored. If lost, `terraform import` can rebuild it from the live resources — the bucket itself is safe.
- Cost: essentially free — S3 stores a few KB of state per environment.
