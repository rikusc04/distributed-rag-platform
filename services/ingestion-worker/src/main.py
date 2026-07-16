"""Ingestion worker entrypoint.

Loop: poll SQS → download from S3 → chunk → embed → upsert to pgvector.
"""

from __future__ import annotations

from .config import load_config
from .metrics import start_metrics_server
from .poller import run_forever


def main() -> None:
    cfg = load_config()
    start_metrics_server(cfg.metrics_port)
    run_forever(cfg)


if __name__ == "__main__":
    main()
