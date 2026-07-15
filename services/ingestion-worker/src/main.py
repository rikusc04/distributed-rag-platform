"""Ingestion worker entrypoint.

Loop: poll SQS → download from S3 → chunk → embed → upsert to pgvector.
Filled in during Week 1.
"""

from __future__ import annotations


def main() -> None:
    raise NotImplementedError("Week 1: implement SQS poll loop")


if __name__ == "__main__":
    main()
