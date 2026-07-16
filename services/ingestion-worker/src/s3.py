"""S3 helpers: download an object and extract plain text.

We keep the surface small on purpose — PDFs and text files cover the demo
corpus. Anything else raises so the message goes to the DLQ instead of
silently indexing garbage.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import boto3
from pypdf import PdfReader


@dataclass(frozen=True)
class Document:
    s3_key: str
    source_name: str
    mime: str
    text: str


class UnsupportedMimeError(Exception):
    pass


def _guess_mime(key: str) -> str:
    lower = key.lower()
    if lower.endswith(".pdf"):
        return "application/pdf"
    if lower.endswith(".txt") or lower.endswith(".md"):
        return "text/plain"
    return "application/octet-stream"


def _extract_pdf_text(raw: bytes) -> str:
    reader = PdfReader(io.BytesIO(raw))
    pages: list[str] = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return "\n\n".join(pages)


def _extract_plain_text(raw: bytes) -> str:
    return raw.decode("utf-8", errors="replace")


def fetch_document(bucket: str, key: str, region: str) -> Document:
    """Download s3://bucket/key and return a Document with extracted text."""
    client = boto3.client("s3", region_name=region)
    response = client.get_object(Bucket=bucket, Key=key)
    raw = response["Body"].read()

    mime = _guess_mime(key)
    if mime == "application/pdf":
        text = _extract_pdf_text(raw)
    elif mime == "text/plain":
        text = _extract_plain_text(raw)
    else:
        raise UnsupportedMimeError(f"unsupported object type: {key}")

    source_name = key.rsplit("/", 1)[-1]
    return Document(s3_key=key, source_name=source_name, mime=mime, text=text)
