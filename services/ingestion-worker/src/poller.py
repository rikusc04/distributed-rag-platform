"""SQS receive loop.

Long-polls the ingest queue, decodes each S3 event notification, and hands
the (tenant_id, s3_key) pair off to the document pipeline. Messages that
succeed are deleted; messages that fail are left on the queue so SQS's own
redrive policy sends them to the DLQ after `maxReceiveCount` attempts.

Tenant assignment: S3 keys are laid out `tenant-<uuid>/<filename>` — the
first path segment is the tenant id. If it doesn't parse, the message goes
straight to the DLQ (not our fault, don't retry forever).
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass

import boto3
import structlog

from .chunker import chunk_text
from .config import Config
from .db import upsert_document
from .embedder import Embedder
from .metrics import (
    CHUNKS_WRITTEN,
    DOC_LATENCY,
    DOCS_FAILED,
    DOCS_INGESTED,
    EMBED_LATENCY,
    MESSAGES_RECEIVED,
)
from .s3 import UnsupportedMimeError, fetch_document

log = structlog.get_logger()


@dataclass(frozen=True)
class IngestJob:
    tenant_id: str
    bucket: str
    s3_key: str


class BadMessageError(Exception):
    """The message is not something we can ever handle — send to DLQ, don't retry."""


def _parse_tenant_from_key(key: str) -> str:
    prefix = key.split("/", 1)[0]
    if not prefix.startswith("tenant-"):
        raise BadMessageError(f"s3 key missing tenant- prefix: {key}")
    tenant_str = prefix[len("tenant-") :]
    try:
        return str(uuid.UUID(tenant_str))
    except ValueError as exc:
        raise BadMessageError(f"invalid tenant uuid in s3 key: {key}") from exc


def _parse_message(body: str) -> list[IngestJob]:
    """Decode an SQS message body containing an S3 event notification.

    S3 sends a top-level `{"Records": [...]}` payload; each record has
    `s3.bucket.name` and `s3.object.key`.
    """
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise BadMessageError("body is not valid json") from exc

    records = payload.get("Records")
    if not isinstance(records, list) or len(records) == 0:
        raise BadMessageError("payload has no Records[]")

    jobs: list[IngestJob] = []
    for record in records:
        s3 = record.get("s3") or {}
        bucket = (s3.get("bucket") or {}).get("name")
        key = (s3.get("object") or {}).get("key")
        if not bucket or not key:
            raise BadMessageError("record missing s3.bucket.name or s3.object.key")
        tenant_id = _parse_tenant_from_key(key)
        jobs.append(IngestJob(tenant_id=tenant_id, bucket=bucket, s3_key=key))
    return jobs


def _process_job(cfg: Config, embedder: Embedder, job: IngestJob) -> None:
    doc_start = time.perf_counter()

    document = fetch_document(job.bucket, job.s3_key, cfg.aws_region)

    chunks = chunk_text(document.text, cfg.chunk_tokens, cfg.chunk_overlap_tokens)
    if len(chunks) == 0:
        log.warning("empty_document", key=job.s3_key)
        DOCS_FAILED.labels(reason="empty").inc()
        return

    embed_start = time.perf_counter()
    vectors = embedder.embed(chunks)
    EMBED_LATENCY.observe(time.perf_counter() - embed_start)

    result = upsert_document(
        cfg.db,
        job.tenant_id,
        document.s3_key,
        document.source_name,
        document.mime,
        chunks,
        vectors,
    )

    DOCS_INGESTED.inc()
    CHUNKS_WRITTEN.inc(result.chunks_written)
    DOC_LATENCY.observe(time.perf_counter() - doc_start)

    log.info(
        "ingested",
        tenant_id=job.tenant_id,
        document_id=result.document_id,
        chunks=result.chunks_written,
        s3_key=job.s3_key,
    )


def run_forever(cfg: Config) -> None:
    sqs = boto3.client("sqs", region_name=cfg.aws_region)
    embedder = Embedder(cfg.openai_api_key, cfg.openai_embed_model, cfg.embed_dim)

    log.info(
        "worker_starting",
        queue=cfg.queue_url,
        bucket=cfg.bucket_name,
        embed_model=cfg.openai_embed_model,
    )

    while True:
        response = sqs.receive_message(
            QueueUrl=cfg.queue_url,
            MaxNumberOfMessages=cfg.max_messages_per_receive,
            WaitTimeSeconds=cfg.poll_wait_seconds,
        )
        messages = response.get("Messages") or []
        if len(messages) == 0:
            continue

        for message in messages:
            MESSAGES_RECEIVED.inc()
            receipt = message["ReceiptHandle"]
            body = message.get("Body", "")

            try:
                jobs = _parse_message(body)
            except BadMessageError as exc:
                log.error("bad_message", error=str(exc))
                DOCS_FAILED.labels(reason="bad_message").inc()
                sqs.delete_message(QueueUrl=cfg.queue_url, ReceiptHandle=receipt)
                continue

            all_ok = True
            for job in jobs:
                try:
                    _process_job(cfg, embedder, job)
                except UnsupportedMimeError as exc:
                    log.error("unsupported_mime", error=str(exc))
                    DOCS_FAILED.labels(reason="unsupported_mime").inc()
                except Exception as exc:
                    log.exception("process_failed", key=job.s3_key, error=str(exc))
                    DOCS_FAILED.labels(reason="exception").inc()
                    all_ok = False

            if all_ok:
                sqs.delete_message(QueueUrl=cfg.queue_url, ReceiptHandle=receipt)
