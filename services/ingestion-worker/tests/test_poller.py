import uuid

import pytest

from src.poller import BadMessageError, _parse_message, _parse_tenant_from_key


def test_parse_tenant_ok() -> None:
    tid = str(uuid.uuid4())
    key = f"tenant-{tid}/handbook.pdf"
    assert _parse_tenant_from_key(key) == tid


def test_parse_tenant_missing_prefix() -> None:
    with pytest.raises(BadMessageError):
        _parse_tenant_from_key("handbook.pdf")


def test_parse_tenant_bad_uuid() -> None:
    with pytest.raises(BadMessageError):
        _parse_tenant_from_key("tenant-not-a-uuid/handbook.pdf")


def test_parse_message_ok() -> None:
    tid = str(uuid.uuid4())
    body = (
        '{"Records":[{"s3":{"bucket":{"name":"my-bucket"},'
        f'"object":{{"key":"tenant-{tid}/handbook.pdf"}}}}}}]}}'
    )
    jobs = _parse_message(body)
    assert len(jobs) == 1
    assert jobs[0].bucket == "my-bucket"
    assert jobs[0].tenant_id == tid


def test_parse_message_bad_json() -> None:
    with pytest.raises(BadMessageError):
        _parse_message("{not json")


def test_parse_message_no_records() -> None:
    with pytest.raises(BadMessageError):
        _parse_message('{"foo": "bar"}')
