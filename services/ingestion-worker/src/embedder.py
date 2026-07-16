"""Embed chunks using the OpenAI embeddings API.

The API takes a list of inputs per call, up to a generous batch size. We
send everything for one document in one request to keep the round trips
low — a 20-page PDF is ~50 chunks, well under any single-request limit.
"""

from __future__ import annotations

from openai import OpenAI


class Embedder:
    def __init__(self, api_key: str, model: str, expected_dim: int) -> None:
        self._client = OpenAI(api_key=api_key)
        self._model = model
        self._expected_dim = expected_dim

    def embed(self, chunks: list[str]) -> list[list[float]]:
        if len(chunks) == 0:
            return []

        response = self._client.embeddings.create(model=self._model, input=chunks)

        vectors: list[list[float]] = []
        for item in response.data:
            if len(item.embedding) != self._expected_dim:
                raise RuntimeError(
                    f"embedding dim mismatch: got {len(item.embedding)}, "
                    f"expected {self._expected_dim}"
                )
            vectors.append(item.embedding)
        return vectors
