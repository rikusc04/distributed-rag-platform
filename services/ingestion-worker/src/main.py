"""Ingestion worker entrypoint.

Loop: poll SQS → download from S3 → chunk → embed → upsert to pgvector.
"""

from __future__ import annotations


def main() -> None:
    raise NotImplementedError("SQS poll loop not implemented yet")


if __name__ == "__main__":
    main()
