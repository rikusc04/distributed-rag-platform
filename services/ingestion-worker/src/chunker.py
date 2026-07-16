"""Token-based chunking with fixed overlap.

We split on token boundaries so the embedding model sees the same units
it was trained on. `cl100k_base` is the tokenizer for text-embedding-3-*.
"""

from __future__ import annotations

import tiktoken

_ENCODER = tiktoken.get_encoding("cl100k_base")


def chunk_text(text: str, chunk_tokens: int, overlap_tokens: int) -> list[str]:
    """Split `text` into chunks of `chunk_tokens` tokens with `overlap_tokens`
    overlap between neighbours. Returns the decoded strings, in order.
    """
    if chunk_tokens <= 0:
        raise ValueError("chunk_tokens must be positive")
    if overlap_tokens < 0 or overlap_tokens >= chunk_tokens:
        raise ValueError("overlap_tokens must be in [0, chunk_tokens)")

    tokens = _ENCODER.encode(text)
    if len(tokens) == 0:
        return []

    step = chunk_tokens - overlap_tokens
    chunks: list[str] = []
    start = 0
    while start < len(tokens):
        end = start + chunk_tokens
        window = tokens[start:end]
        chunks.append(_ENCODER.decode(window))
        if end >= len(tokens):
            break
        start += step
    return chunks
