"""Postgres writes: upsert a document row and its chunks in one transaction.

`app.current_tenant` is set at the start of the transaction so the row-level
security policies on `documents` and `chunks` scope every write to the
tenant we're ingesting for.
"""

from __future__ import annotations

from dataclasses import dataclass

import psycopg
from pgvector.psycopg import register_vector

from .config import DbCreds


@dataclass(frozen=True)
class UpsertResult:
    document_id: str
    chunks_written: int


def _connect(creds: DbCreds) -> psycopg.Connection:
    conn = psycopg.connect(
        host=creds.host,
        port=creds.port,
        dbname=creds.dbname,
        user=creds.username,
        password=creds.password,
        autocommit=False,
    )
    register_vector(conn)
    return conn


def upsert_document(
    creds: DbCreds,
    tenant_id: str,
    s3_key: str,
    source_name: str,
    mime: str,
    chunks: list[str],
    embeddings: list[list[float]],
) -> UpsertResult:
    if len(chunks) != len(embeddings):
        raise ValueError("chunks and embeddings length mismatch")

    with _connect(creds) as conn, conn.cursor() as cur:
        cur.execute("SELECT set_config('app.current_tenant', %s, true)", (tenant_id,))

        cur.execute(
            """
            INSERT INTO documents (tenant_id, s3_key, source_name, mime, status, ingested_at)
            VALUES (%s, %s, %s, %s, 'ingested', now())
            ON CONFLICT (tenant_id, s3_key)
            DO UPDATE SET
                source_name = EXCLUDED.source_name,
                mime        = EXCLUDED.mime,
                status      = 'ingested',
                ingested_at = now()
            RETURNING id
            """,
            (tenant_id, s3_key, source_name, mime),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("document upsert returned no id")
        document_id = str(row[0])

        cur.execute("DELETE FROM chunks WHERE document_id = %s", (document_id,))

        i = 0
        while i < len(chunks):
            cur.execute(
                """
                INSERT INTO chunks
                    (tenant_id, document_id, chunk_idx, content, embedding)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (tenant_id, document_id, i, chunks[i], embeddings[i]),
            )
            i += 1

        conn.commit()

    return UpsertResult(document_id=document_id, chunks_written=len(chunks))
