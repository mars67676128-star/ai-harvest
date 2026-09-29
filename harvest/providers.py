"""The only external AI edge. No tools, database handles or governance authority."""

import hashlib
import json
from pathlib import Path
from typing import Protocol

import httpx
from pydantic import BaseModel

from .config import Settings
from .errors import DomainError
from .fixtures import (
    BACKFLOW_TEXT,
    OPS_TRANSCRIPT,
    TENANT_TRANSCRIPT,
    operations_content,
    revised_operations,
    tenant_content,
)


class LLMProvider(Protocol):
    def structured_generate(
        self, operation: str, payload: dict, schema: dict
    ) -> tuple[dict, dict]: ...


def prompt_info(operation):
    version = f"{operation}.v1"
    text = (Path(__file__).parent / "prompts" / f"{version}.txt").read_text(encoding="utf-8")
    return text, {
        "prompt_version": version,
        "prompt_hash": hashlib.sha256(text.encode()).hexdigest(),
    }


class MockProvider:
    """Honest fixture replay, not a language-understanding fallback."""

    def structured_generate(self, operation, payload, schema):
        _, meta = prompt_info(operation)
        if operation == "extract":
            capture = payload["capture"]
            fixtures = {OPS_TRANSCRIPT: operations_content, TENANT_TRANSCRIPT: tenant_content}
            if not capture["synthetic"] or capture["transcript"] not in fixtures:
                raise DomainError(
                    422,
                    "MOCK_FIXTURE_ONLY",
                    "Offline extraction supports the exact labelled demo interviews. Configure a live provider for other text.",
                )
            content = fixtures[capture["transcript"]]()
            data = {
                "summary": "Synthetic fixture extraction: judgement, exceptions and escalation captured.",
                "elicitation_gaps": [],
                "content": content.model_dump(mode="json"),
            }
        elif operation == "revise":
            if payload["feedback"]["correction"] != BACKFLOW_TEXT or any(
                i["key"] == "drain_backflow" for i in payload["current"]["inputs"]
            ):
                raise DomainError(
                    422,
                    "MOCK_FIXTURE_ONLY",
                    "Offline revision supports only the labelled demo backflow correction once.",
                )
            data = revised_operations(payload["current"]).model_dump(mode="json")
        elif operation == "explain":
            result = payload["result"]
            data = {
                "summary": f"The governed rule workflow returned {result['decision']}; {len(result['blocked_actions'])} action(s) blocked across capabilities.",
                "uncertainty": "Synthetic fixture narration. Verified observations and qualified human assessment remain necessary.",
            }
        else:
            raise ValueError("Unsupported generation operation")
        return data, {
            **meta,
            "provider": "mock",
            "model": "deterministic-fixture-v1",
            "live": False,
            "request_id": None,
        }


class CompatibleProvider:
    def __init__(self, settings: Settings, transport=None):
        self.settings = settings
        self.transport = transport

    def structured_generate(self, operation, payload, schema):
        prompt, meta = prompt_info(operation)
        with httpx.Client(
            timeout=self.settings.timeout, transport=self.transport, follow_redirects=False
        ) as client:
            response = client.post(
                self.settings.base_url.rstrip("/") + "/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.api_key}"},
                json={
                    "model": self.settings.model,
                    "stream": False,
                    "temperature": 0,
                    "max_tokens": 8000,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {
                            "role": "system",
                            "content": prompt + "\nJSON schema:\n" + json.dumps(schema),
                        },
                        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                    ],
                },
            )
            response.raise_for_status()
            body = response.json()
            choice = body["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise ValueError("Incomplete model response")
            content = choice["message"]["content"]
            if len(content) > 150000:
                raise ValueError("Model response exceeds size limit")
            data = json.loads(content)
            request_id = response.headers.get("x-request-id") or body.get("id")
            return data, {
                **meta,
                "provider": self.settings.provider,
                "model": self.settings.model,
                "live": True,
                "request_id": request_id,
                "usage": body.get("usage", {}),
            }


def make_provider(settings):
    return MockProvider() if settings.provider == "mock" else CompatibleProvider(settings)


def generate(provider: LLMProvider, operation: str, payload: dict, output: type[BaseModel]):
    try:
        data, meta = provider.structured_generate(operation, payload, output.model_json_schema())
        return output.model_validate(data), meta
    except DomainError:
        raise
    except Exception as exc:
        # Provider bodies may contain secrets or submitted text; do not echo them.
        raise DomainError(
            502,
            "LLM_UNAVAILABLE",
            "AI output was unavailable, incomplete or schema-invalid. No production knowledge changed.",
        ) from exc
