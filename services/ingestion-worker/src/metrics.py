"""Prometheus metrics for the ingestion worker.

Scraped on :9090/metrics. Kept intentionally small — these are the numbers
we care about on the Grafana dashboard and in the resume writeup.
"""

from __future__ import annotations

from prometheus_client import Counter, Histogram, start_http_server

MESSAGES_RECEIVED = Counter(
    "ingest_messages_received_total",
    "SQS messages received from the ingest queue",
)

DOCS_INGESTED = Counter(
    "ingest_documents_ingested_total",
    "Documents successfully upserted to pgvector",
)

DOCS_FAILED = Counter(
    "ingest_documents_failed_total",
    "Documents that failed to process and were left for redrive/DLQ",
    ["reason"],
)

CHUNKS_WRITTEN = Counter(
    "ingest_chunks_written_total",
    "Chunks upserted into pgvector",
)

EMBED_LATENCY = Histogram(
    "ingest_embed_latency_seconds",
    "Wall-clock time for one embed() call (one document's chunks)",
    buckets=(0.1, 0.25, 0.5, 1, 2, 5, 10, 30),
)

DOC_LATENCY = Histogram(
    "ingest_document_latency_seconds",
    "End-to-end time to process one document (download → chunk → embed → upsert)",
    buckets=(0.25, 0.5, 1, 2, 5, 10, 30, 60),
)


def start_metrics_server(port: int) -> None:
    start_http_server(port)
