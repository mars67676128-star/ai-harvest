import pytest
from fastapi.testclient import TestClient

from harvest.api import create_app
from harvest.config import Settings
from harvest.demo import call, release
from harvest.fixtures import OPS_ID, operations_content


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(database=str(tmp_path / "test.db")))) as client:
        yield client


def create(client, pill_id=OPS_ID, version="1.0.0", previous=None, content=None):
    return call(
        client,
        "POST",
        "/pills",
        "expert",
        {
            "pill_id": pill_id,
            "version": version,
            "owner": "approver",
            "reviewers": ["reviewer"],
            "content": content or operations_content().model_dump(mode="json"),
            "previous_version": previous,
            "change_reason": "Synthetic test artifact",
        },
    )


@pytest.fixture
def approved(client):
    create(client)
    release(client, OPS_ID, "1.0.0")
    return client
