"""The only external AI edge. No tools, database handles or governance authority."""

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Protocol

import httpx
from pydantic import BaseModel, ValidationError

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


class CompatibleProvider:
    def __init__(self, settings: Settings, transport=None):
        self.settings = settings
        self.transport = transport

    def structured_generate(self, operation, payload, schema):
        prompt, meta = prompt_info(operation)
        # Build the request body first. OpenAI's latest models (e.g. gpt-6.1-terra)
        # reject max_tokens and require max_completion_tokens. Tencent and other
        # OpenAI-compatible endpoints use max_tokens. Select the correct parameter
        # based on the configured base URL — do NOT globally replace either.
        body = {
            "model": self.settings.model,
            "stream": False,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": prompt + "\nJSON schema:\n" + json.dumps(schema),
                },
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
        }
        if "api.openai.com" in self.settings.base_url:
            body["max_completion_tokens"] = 8000
            # gpt-6.1-terra is a reasoning model that defaults to medium effort.
            # Sifu does schema-driven extraction — spend the completion budget on
            # the JSON result, not reasoning tokens.
            body["reasoning_effort"] = "none"
        else:
            body["max_tokens"] = 8000
        with httpx.Client(
            timeout=self.settings.timeout, transport=self.transport, follow_redirects=False
        ) as client:
            response = client.post(
                self.settings.base_url.rstrip("/") + "/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.api_key}"},
                json=body,
            )
            response.raise_for_status()
            body = response.json()
            choice = body["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise ValueError(f"finish_reason={choice.get('finish_reason')}")
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


def _debug_enabled():
    return os.getenv("HARVEST_LLM_DEBUG_ERRORS") == "1"


def _emit_debug(exc):
    """Print sanitized failure-stage diagnostics to stderr.

    Never emits API keys, submitted payloads, response bodies, or model-generated
    content. Only structural metadata (stage, HTTP status, finish reason, Pydantic
    error loc/type) is printed.
    """
    # HTTP/provider rejection — print status code only, never the response body.
    if isinstance(exc, httpx.HTTPStatusError):
        print(f"LLM_DEBUG stage=http status={exc.response.status_code}", file=sys.stderr)
        return
    # Pydantic schema validation — print loc and type only, never input values.
    if isinstance(exc, ValidationError):
        errors = exc.errors()
        print(f"LLM_DEBUG stage=validation error_count={len(errors)}", file=sys.stderr)
        for e in errors:
            loc = ".".join(str(p) for p in e.get("loc", ()))
            etype = e.get("type", "unknown")
            print(f"LLM_DEBUG loc={loc} type={etype}", file=sys.stderr)
        return
    # JSON parsing failure — print marker only, never raw content.
    if isinstance(exc, json.JSONDecodeError):
        print("LLM_DEBUG stage=invalid_json", file=sys.stderr)
        return
    # Finish-reason failure — the ValueError message carries the reason.
    if isinstance(exc, ValueError) and str(exc).startswith("finish_reason="):
        reason = str(exc).split("=", 1)[1]
        print(f"LLM_DEBUG stage=finish_reason reason={reason}", file=sys.stderr)
        return
    # Unexpected exception — print class name only.
    print(f"LLM_DEBUG stage=unexpected error_class={type(exc).__name__}", file=sys.stderr)


def generate(provider: LLMProvider, operation: str, payload: dict, output: type[BaseModel]):
    try:
        data, meta = provider.structured_generate(operation, payload, output.model_json_schema())
        return output.model_validate(data), meta
    except DomainError:
        raise
    except Exception as exc:
        if _debug_enabled():
            _emit_debug(exc)
        # Provider bodies may contain secrets or submitted text; do not echo them.
        raise DomainError(
            502,
            "LLM_UNAVAILABLE",
            "AI output was unavailable, incomplete or schema-invalid. No production knowledge changed.",
        ) from exc
