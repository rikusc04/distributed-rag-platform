# Issues Log

Running log of every issue hit while building this project, and how we solved it. Append new ones at the bottom.

---

## Issue #1 — CI: pytest exits with code 5 ("no tests collected")

**When:** first commit, initial CI run
**Symptom:**
```
no tests ran in 0.00s
##[error]Process completed with exit code 5.
```
**Cause:** pytest returns exit code 5 when it can't find any test files. Our scaffold created `services/ingestion-worker/` with no `tests/` directory yet.  
**Solution:** Added `services/ingestion-worker/tests/test_smoke.py` with a real import test:
```python
from src import main

def test_main_module_importable() -> None:
    assert callable(main.main)
```
This verifies the package imports cleanly. As real logic is added, real tests replace this.

---

## Issue #2 — CI: ESLint 9 fails, "couldn't find eslint.config file"

**When:** first commit, initial CI run
**Symptom:**
```
ESLint: 9.39.5
ESLint couldn't find an eslint.config.(js|mjs|cjs) file.
```
**Cause:** ESLint v9 requires the new flat-config format (`eslint.config.js`), not the old `.eslintrc.*`. We had ESLint 9 in devDeps but no config file.  
**Solution:** For the scaffold phase, dropped `npm run lint` from CI entirely and removed the `eslint` devDependency. Will add back with a proper flat-config once there's meaningful code to lint. TypeScript's own `tsc --noEmit` (typecheck) is doing the heavy lifting for correctness in the meantime.

---

## Issue #3 — CI: vitest exits with code 1 ("no test files found")

**When:** implied — would have surfaced after fixing Issue #2
**Cause:** `vitest run` exits non-zero if no test files exist.  
**Solution:** Changed the `test` npm script to `vitest run --passWithNoTests`. When we add real vitest files later, `--passWithNoTests` becomes a no-op.

---

## Issue #4 — CI: `build-images` workflow fails, missing `AWS_CI_ROLE_ARN` secret

**When:** first commit — the workflow triggered on push and immediately failed
**Cause:** The workflow assumes an OIDC role via `secrets.AWS_CI_ROLE_ARN`, but we haven't provisioned the IAM role or set the secret yet.  
**Solution:** Changed the trigger in `.github/workflows/build-images.yaml` from `push: branches: [main]` to `workflow_dispatch` (manual only). Once we set up the OIDC IAM role in Terraform and add the secret in GitHub, we flip the trigger back.

---

## Issue #5 — Terraform: `dynamodb_table` in S3 backend is deprecated

**When:** running `terraform init` for the dev environment
**Symptom:**
```
Warning: Deprecated Parameter
The parameter "dynamodb_table" is deprecated. Use parameter "use_lockfile" instead.
```
**Cause:** As of Terraform 1.11+, S3 has native state locking (`use_lockfile = true`) using S3 conditional writes, so a separate DynamoDB table is no longer needed.  
**Solution:**
1. Changed `dynamodb_table = "…"` to `use_lockfile = true` in the dev environment's `backend "s3"` block
2. Removed the DynamoDB table resource from `infra/bootstrap` (had to first remove `prevent_destroy = true` and apply, then remove the resource and apply again)

---

## Issue #6 — Terraform: "No configuration files" during apply

**When:** running `terraform apply` from the repo root instead of the environment directory
**Symptom:**
```
Error: No configuration files
Apply requires configuration to be present.
```
**Cause:** Terraform runs against the current working directory. If there are no `.tf` files in that directory, it thinks you want to destroy everything.  
**Solution:** Always `cd` into the specific environment directory before running Terraform commands:
```bash
cd infra/environments/dev
terraform apply
```
Alternatively, use `terraform -chdir=infra/environments/dev apply`.

---

## Issue #7 — Shell: backticks in commit message triggered command substitution

**When:** trying to run `git commit -m "…"` with a message containing `` `npm run lint` `` and `` `vitest --passWithNoTests` ``
**Symptom:**
```
zsh: command not found: vitest
npm error code ENOENT
```
followed by the commit not happening.
**Cause:** zsh interprets backticks inside **double-quoted** strings as command substitution. So the shell tried to *run* `npm run lint` and `vitest --passWithNoTests` before `git commit` saw the message.  
**Solution:** For commit messages containing backticks, either:
- Use single quotes: `git commit -m 'message with `backticks` inside'`
- Use a HEREDOC: `git commit -m "$(cat <<'EOF' … EOF )"` — the `'EOF'` (quoted) prevents any expansion

---

---

## Issue #8 — AWS Free Plan silently blocks non-Free-Tier EC2 instance types

**When:** first `terraform apply` bringing up the full dev stack
**Symptom:** EKS node group stuck in `CREATING` for 20+ minutes. Terraform just kept printing `Still creating...`. EKS reported no health issues. After digging into the ASG's scaling activities:
```
"Could not launch On-Demand Instances. InvalidParameterCombination -
The specified instance type is not eligible for Free Tier."
```
**Cause:** The **new AWS Free Plan** (launched 2025) blocks any EC2 launches that aren't Free-Tier-eligible — only `t3.micro` qualifies. This is different from the old Free Tier, which let you launch anything but only certain types were free. On the new plan, non-eligible instance types get flat-out rejected. So `t3.medium` (our node type) was refused.

The problem was silent because EKS's node-group `health.issues` didn't surface the ASG-level failure — it just kept the node group in `CREATING` while the ASG kept retrying.  
**Solution:**
1. Sign in to AWS Console **as root user** (IAM users can't do this by default) and click **Upgrade plan** in the Cost and usage widget. Add a payment method. Any signup credits still apply to your bill first — no out-of-pocket cost until credits run out.
2. Delete the stuck node group: `aws eks delete-nodegroup --cluster-name … --nodegroup-name …`
3. Re-run `terraform apply` — Terraform detects the missing node group and recreates it, this time successfully.

**How to debug this fast if it happens again:** always check the ASG activities, not just EKS status:
```bash
ASG=$(aws eks describe-nodegroup --cluster-name <cluster> --nodegroup-name <ng> \
      --query "nodegroup.resources.autoScalingGroups[0].name" --output text)
aws autoscaling describe-scaling-activities --auto-scaling-group-name "$ASG" \
      --query "Activities[*].[StatusCode,StatusMessage]"
```

---

---

## Issue #9 — RDS: `Cannot find version 16.6 for postgres`

**When:** second `terraform apply` (after Free-Plan upgrade). EKS and ElastiCache created cleanly; RDS creation failed.
**Symptom:**
```
Error: creating RDS DB Instance (rag-platform-dev-postgres): api error
  InvalidParameterCombination: Cannot find version 16.6 for postgres
```
**Cause:** RDS doesn't offer every minor Postgres version — I'd hardcoded `engine_version = "16.6"` which doesn't exist in the RDS catalog. Available Postgres 16 versions at the time: 16.3, 16.4, 16.9, 16.10, 16.11, 16.12, 16.13, 16.14.  
**Solution:** Query what's actually available and pin to a real version:
```bash
aws rds describe-db-engine-versions --engine postgres --region us-east-1 \
  --query "DBEngineVersions[?starts_with(EngineVersion, '16.') && Status=='available'].EngineVersion" \
  --output text
```
Then update `infra/modules/rds/variables.tf` default to a real version (used `16.14`). Terraform's next apply picks it up on the retry.

**How to avoid:** don't guess Postgres minor versions — always query first, or use just the major version if the AWS provider supports it (some do accept `"16"` and pick a default).

---

## Issue #10 — Semantic cache does not skip chat completion on `ask` [resolved]

**When:** local benchmark of the MCP gateway (`bench/results/findings.md`)
**Symptom:** With cache hit rate at ~99% on paraphrase workloads, `ask` p95 stayed at ~1.6 s and per-query LLM cost was unchanged.
**Cause:** `services/mcp-gateway/src/tools.ts` `ask()` called `openai.chat.completions.create` on every request. The `SemanticCache` in `cache.ts` only cached the retrieved chunk list, not the final answer. So a cache hit short-circuited the ~2 ms pg vector search but still paid for the ~1 s chat completion.
**Resolution:** made `SemanticCache<T>` generic and instantiated a second one (`answerCache`) under the `q-cache-ans:` Redis key prefix that stores full `{answer, citations}` payloads. `ask()` checks it first; on hit it skips both retrieval and the chat call. Result: p95 1266 ms → 285 ms and ~99.65% of chat completions skipped on the warm benchmark. Not invalidated on new-document ingest; relies on `CACHE_TTL_SECONDS` (default 1 h) same as the chunk cache.

---

## Issue #11 — Gateway `pg` pool hardcoded `ssl: { rejectUnauthorized: false }` — broke local docker postgres

**When:** first attempt to run the gateway against the local docker stack for the benchmark.
**Symptom:** `pg` client hung, then closed the connection with a TLS error — local postgres doesn't serve TLS.
**Cause:** `services/mcp-gateway/src/db.ts` set `ssl: { rejectUnauthorized: false }` unconditionally, which forces TLS on every connection. Fine for RDS (which requires TLS); wrong for any postgres that doesn't offer it.
**Solution:** gated on a `DB_SSL` env var — `ssl` is set only when `DB_SSL=true`. The Helm chart defaults `dbSsl: true`, so prod behavior is unchanged. Local `./scripts/dev-up.sh` runs the gateway with `DB_SSL=false`.

---

## Issue #12 — `z.coerce.boolean("false")` returns `true`

**When:** first attempt to compare cache-ON vs cache-OFF in the benchmark. The "cache OFF" run showed a nearly identical p95 to cache ON. Digging into `/metrics` revealed the "cache OFF" run had 2667 cache hits — the flag was ignored.
**Cause:** `cacheEnabled` was declared as `z.coerce.boolean().default(true)`. Zod's coerce path runs `Boolean(input)` on strings, and in JavaScript `Boolean("false")` is `true` (any non-empty string is truthy). So `CACHE_ENABLED=false` parsed as `true`.
**Solution:** replaced the coerce with an explicit string→bool schema:
```ts
cacheEnabled: z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .default(true)
  .transform((v) => v === true || v === "true" || v === "1"),
```
**Lesson:** `z.coerce.boolean()` is a footgun for env-var config; only `z.coerce.number()` and `z.coerce.string()` behave the way most people expect. Audit any other env-driven booleans (this project has none as of the fix).
