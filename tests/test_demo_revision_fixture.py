from harvest.demo_corrections import BACKFLOW_REVISED_TEXT
from harvest.fixtures import operations_content
from harvest.providers import MockProvider


def test_offline_provider_accepts_revised_backflow_demo_correction():
    provider = MockProvider()
    data, meta = provider.structured_generate(
        "revise",
        {
            "feedback": {"correction": BACKFLOW_REVISED_TEXT},
            "current": operations_content().model_dump(mode="json"),
            "outcome": {"summary": "synthetic"},
        },
        {},
    )

    assert any(item["key"] == "drain_backflow" for item in data["inputs"])
    assert meta["provider"] == "mock"
    assert meta["live"] is False
