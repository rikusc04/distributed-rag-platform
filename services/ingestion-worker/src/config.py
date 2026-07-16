"""Runtime configuration for the ingestion worker.

Everything the worker needs to talk to AWS, OpenAI, and Postgres is loaded
here — from env vars for non-secrets, and from Secrets Manager for the DB
credentials that Terraform provisioned.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

import boto3


@dataclass(frozen=True)
class DbCreds:
    host: str
    port: int
    dbname: str
    username: str
    password: str


@dataclass(frozen=True)
class Config:
    aws_region: str
    queue_url: str
    dlq_url: str
    bucket_name: str
    db: DbCreds
    openai_api_key: str
    openai_embed_model: str
    embed_dim: int
    chunk_tokens: int
    chunk_overlap_tokens: int
    poll_wait_seconds: int
    max_messages_per_receive: int
    metrics_port: int


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required env var: {name}")
    return value


def _load_db_creds(region: str) -> DbCreds:
    """Fetch DB creds. Prefer a Secrets Manager ARN so we match how Terraform
    provisions them; fall back to plain env vars for local dev.
    """
    secret_arn = os.environ.get("DB_SECRET_ARN")
    host = _require_env("DB_HOST")
    port = int(os.environ.get("DB_PORT", "5432"))
    dbname = _require_env("DB_NAME")

    if secret_arn:
        client = boto3.client("secretsmanager", region_name=region)
        response = client.get_secret_value(SecretId=secret_arn)
        payload = json.loads(response["SecretString"])
        return DbCreds(
            host=host,
            port=port,
            dbname=dbname,
            username=payload["username"],
            password=payload["password"],
        )

    return DbCreds(
        host=host,
        port=port,
        dbname=dbname,
        username=_require_env("DB_USER"),
        password=_require_env("DB_PASSWORD"),
    )


def load_config() -> Config:
    region = os.environ.get("AWS_REGION", "us-east-1")
    return Config(
        aws_region=region,
        queue_url=_require_env("INGEST_QUEUE_URL"),
        dlq_url=os.environ.get("INGEST_DLQ_URL", ""),
        bucket_name=_require_env("DOCS_BUCKET"),
        db=_load_db_creds(region),
        openai_api_key=_require_env("OPENAI_API_KEY"),
        openai_embed_model=os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small"),
        embed_dim=int(os.environ.get("EMBED_DIM", "1536")),
        chunk_tokens=int(os.environ.get("CHUNK_TOKENS", "1000")),
        chunk_overlap_tokens=int(os.environ.get("CHUNK_OVERLAP_TOKENS", "100")),
        poll_wait_seconds=int(os.environ.get("POLL_WAIT_SECONDS", "20")),
        max_messages_per_receive=int(os.environ.get("MAX_MESSAGES_PER_RECEIVE", "5")),
        metrics_port=int(os.environ.get("METRICS_PORT", "9090")),
    )
