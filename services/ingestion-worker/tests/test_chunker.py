from src.chunker import chunk_text


def test_empty_text_returns_empty_list() -> None:
    assert chunk_text("", 100, 10) == []


def test_short_text_becomes_one_chunk() -> None:
    text = "hello world"
    chunks = chunk_text(text, 100, 10)
    assert len(chunks) == 1
    assert "hello" in chunks[0]


def test_chunks_have_overlap() -> None:
    # ~200 tokens of unique-ish text so we know we'll get multiple chunks
    words = []
    i = 0
    while i < 400:
        words.append(f"word{i}")
        i += 1
    text = " ".join(words)

    chunks = chunk_text(text, 50, 10)
    assert len(chunks) >= 2

    # The overlap window should mean some tokens from chunk N appear in chunk N+1.
    # Cheap check: the last ~5 tokens of chunk 0 appear in chunk 1.
    tail = chunks[0].split()[-5:]
    for word in tail:
        assert word in chunks[1]


def test_invalid_chunk_size_raises() -> None:
    try:
        chunk_text("hello", 0, 0)
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_invalid_overlap_raises() -> None:
    try:
        chunk_text("hello", 10, 10)
    except ValueError:
        return
    raise AssertionError("expected ValueError")
