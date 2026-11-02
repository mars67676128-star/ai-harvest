"""The only external AI edge. No tools, database handles or governance authority."""

import hashlib
import json
import logging
from pathlib import Path
from typing import Protocol

import httpx
from pydantic import BaseModel

from .config import Settings
from .demo_corrections import BACKFLOW_REVISED_TEXT
from .errors import DomainError
from .fixtures import (
    BACKFLOW_TEXT,
    OPS_TRANSCRIPT,
    TENANT_TRANSCRIPT,
    operations_content,
    revised_operations,
    tenant_content,
)

logger = logging.getLogger("harvest.providers")


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


def _strict_response_schema(schema: dict) -> dict:
    """Adapt a Pydantic JSON schema to OpenAI strict Structured Outputs.

    Pydantic represents fields with Python defaults as optional in JSON Schema. OpenAI
    strict Structured Outputs instead requires every object property to appear in
    ``required``. Nullable fields remain nullable through their existing ``anyOf``/null
    schema, so making the key required does not change the application-level semantics.

    ``default`` annotations are removed because the model must emit every field rather
    than relying on a server- or client-side default.
    """

    def normalise(node):
        if isinstance(node, list):
            return [normalise(item) for item in node]
        if not isinstance(node, dict):
            return node

        cleaned = {
            key: normalise(value)
            for key, value in node.items()
            if key != "default"
        }
        properties = cleaned.get("properties")
        if isinstance(properties, dict):
            cleaned["required"] = list(properties.keys())
            cleaned["additionalProperties"] = False
        return cleaned

    return normalise(schema)


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
            accepted_corrections = {BACKFLOW_TEXT, BACKFLOW_REVISED_TEXT}
            if payload["feedback"]["correction"] not in accepted_corrections or any(
                i["key"] == "drain_backflow" for i in payload["current"]["inputs"]
            ):
                raise DomainError(
                    422,
                    "MOCK_FIXTURE_ONLY",
                    "Offline revision supports only the labelled synthetic backflow corrections against the original approved demo Pill.",
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


class OpenAIProvider:
    """OpenAI Responses API provider with reasoning and strict Structured Outputs."""

    def __init__(self, settings: Settings, transport=None):
        self.settings = settings
        self.transport = transport

    def structured_generate(self, operation, payload, schema):
        prompt, meta = prompt_info(operation)
        strict_schema = _strict_response_schema(schema)
        with httpx.Client(
            timeout=self.settings.timeout, transport=self.transport, follow_redirects=False
        ) as client:
            response = client.post(
                self.settings.base_url.rstrip("/") + "/responses",
                headers={
                    "Authorization": f"Bearer {self.settings.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.settings.model,
                    "instructions": prompt + "\n\nJSON schema is enforced by the response format below.",
                    "input": json.dumps(payload, ensure_ascii=False),
                    "reasoning": {"effort": self.settings.reasoning_effort},
                    "max_output_tokens": 8000,
                    "text": {
                        "format": {
                            "type": "json_schema",
                            "name": f"{operation}_response",
                            "strict": True,
                            "schema": strict_schema,
                        }
                    },
                },
            )
            request_id = response.headers.get("x-request-id")
            if not response.is_success:
                logger.warning(
                    "OpenAI Responses API returned HTTP %s request_id=%s",
                    response.status_code,
                    request_id or "unknown",
                )
                response.raise_for_status()

            body = response.json()
            request_id = request_id or body.get("id")
            if body.get("status") != "completed":
                reason = (body.get("incomplete_details") or {}).get("reason") or body.get("status")
                logger.warning(
                    "OpenAI response not completed status=%s reason=%s request_id=%s",
                    body.get("status"),
                    reason or "unknown",
                    request_id or "unknown",
                )
                raise ValueError("Incomplete model response")

            parts = []
            for item in body.get("output", []):
                if item.get("type") != "message":
                    continue
                for content in item.get("content", []):
                    if content.get("type") == "output_text":
                        parts.append(content.get("text", ""))
                    elif content.get("type") == "refusal":
                        logger.warning(
                            "OpenAI model refused structured output request_id=%s",
                            request_id or "unknown",
                        )
                        raise ValueError("Model refused structured output")

            text = "".join(parts).strip()
            if not text:
                logger.warning(
                    "OpenAI response contained no output_text request_id=%s",
                    request_id or "unknown",
                )
                raise ValueError("Model returned no output text")
            if len(text) > 150000:
                raise ValueError("Model response exceeds size limit")
            data = json.loads(text)
            return data, {
                **meta,
                "provider": "openai",
                "model": self.settings.model,
                "reasoning_effort": self.settings.reasoning_effort,
                "live": True,
                "request_id": request_id,
                "usage": body.get("usage", {}),
            }


class CompatibleProvider:
    """Generic OpenAI-compatible Chat Completions adapter kept for portability."""

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
    if settings.provider == "mock":
        return MockProvider()
    if settings.provider == "openai":
        return OpenAIProvider(settings)
    return CompatibleProvider(settings)


def generate(provider: LLMProvider, operation: str, payload: dict, output: type[BaseModel]):
    try:
        data, meta = provider.structured_generate(operation, payload, output.model_json_schema())
        return output.model_validate(data), meta
    except DomainError:
        raise
    except Exception as exc:
        # Provider bodies may contain secrets or submitted text; do not echo them.
        logger.warning("LLM generation failed operation=%s error_type=%s", operation, type(exc).__name__)
        raise DomainError(
            502,
            "LLM_UNAVAILABLE",
            "AI output was unavailable, incomplete or schema-invalid. No production knowledge changed.",
        ) from exc
