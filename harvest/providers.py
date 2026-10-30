"""The only external AI edge. No tools, database handles or governance authority."""

import hashlib
import json
import os
import sys
import time
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

# Transient failures eligible for exactly one retry (max 2 total attempts).
_RETRYABLE_TRANSPORT = (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError)
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_RETRY_BACKOFF_SECONDS = 0.75
_MAX_ATTEMPTS = 2


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


def _is_openai(base_url: str) -> bool:
    return "api.openai.com" in base_url


def _structured_outputs_response_format(operation: str, schema: dict) -> dict:
    """Build an OpenAI Structured Outputs response_format dict."""
    return {
        "type": "json_schema",
        "json_schema": {
            "name": f"sifu_{operation}",
            "strict": True,
            "schema": schema,
        },
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

    def _build_body(self, operation, prompt, payload, schema):
        body = {
            "model": self.settings.model,
            "stream": False,
            "temperature": 0,
            "messages": [
                {
                    "role": "system",
                    "content": prompt + "\nJSON schema:\n" + json.dumps(schema),
                },
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
        }
        if _is_openai(self.settings.base_url):
            # OpenAI Structured Outputs: enforce the supplied Pydantic schema
            # server-side with strict mode. This replaces json_object mode for
            # api.openai.com endpoints.
            body["response_format"] = _structured_outputs_response_format(operation, schema)
            # OpenAI's latest models (e.g. gpt-6.1-terra) reject max_tokens and
            # require max_completion_tokens.
            body["max_completion_tokens"] = 8000
            # gpt-6.1-terra is a reasoning model that defaults to medium effort.
            # Sifu does schema-driven extraction — spend the completion budget on
            # the JSON result, not reasoning tokens.
            body["reasoning_effort"] = "none"
        else:
            # Tencent and other OpenAI-compatible endpoints use json_object mode.
            body["response_format"] = {"type": "json_object"}
            body["max_tokens"] = 8000
        return body

    def _single_request(self, client, body):
        """Execute one HTTP attempt. Raises on transport/HTTP failures;
        raises ValueError on finish_reason problems; returns parsed data."""
        response = client.post(
            self.settings.base_url.rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {self.settings.api_key}"},
            json=body,
        )
        response.raise_for_status()
        resp_body = response.json()
        choice = resp_body["choices"][0]
        if choice.get("finish_reason") != "stop":
            raise ValueError(f"finish_reason={choice.get('finish_reason')}")
        content = choice["message"]["content"]
        if len(content) > 150000:
            raise ValueError("Model response exceeds size limit")
        data = json.loads(content)
        request_id = response.headers.get("x-request-id") or resp_body.get("id")
        return data, {
            "request_id": request_id,
            "usage": resp_body.get("usage", {}),
        }

    def structured_generate(self, operation, payload, schema):
        prompt, meta = prompt_info(operation)
        body = self._build_body(operation, prompt, payload, schema)
        last_exc = None
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                with httpx.Client(
                    timeout=self.settings.timeout,
                    transport=self.transport,
                    follow_redirects=False,
                ) as client:
                    data, result_meta = self._single_request(client, body)
                return data, {
                    **meta,
                    "provider": self.settings.provider,
                    "model": self.settings.model,
                    "live": True,
                    **result_meta,
                }
            except Exception as exc:
                last_exc = exc
                if attempt < _MAX_ATTEMPTS and _is_retryable(exc):
                    if _debug_enabled():
                        _emit_debug(exc, attempt=attempt)
                    time.sleep(_RETRY_BACKOFF_SECONDS)
                    continue
                # Non-retryable or final attempt — propagate.
                raise
        # Unreachable: loop either returns or raises on every path.
        raise last_exc  # pragma: no cover


def _is_retryable(exc) -> bool:
    """Return True only for transient transport/HTTP failures."""
    if isinstance(exc, _RETRYABLE_TRANSPORT):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRYABLE_STATUS
    return False


def make_provider(settings):
    return MockProvider() if settings.provider == "mock" else CompatibleProvider(settings)


def _debug_enabled():
    return os.getenv("HARVEST_LLM_DEBUG_ERRORS") == "1"


def _emit_debug(exc, attempt=0):
    """Print sanitized failure-stage diagnostics to stderr.

    Never emits API keys, submitted payloads, response bodies, or model-generated
    content. Only structural metadata (stage, HTTP status, finish reason, Pydantic
    error loc/type, attempt number) is printed.
    """
    prefix = f"attempt={attempt}" if attempt else "attempt=final"
    # HTTP/provider rejection — print status code only, never the response body.
    if isinstance(exc, httpx.HTTPStatusError):
        print(f"LLM_DEBUG stage=http status={exc.response.status_code} {prefix}", file=sys.stderr)
        return
    # Pydantic schema validation — print loc and type only, never input values.
    if isinstance(exc, ValidationError):
        errors = exc.errors()
        print(f"LLM_DEBUG stage=validation error_count={len(errors)} {prefix}", file=sys.stderr)
        for e in errors:
            loc = ".".join(str(p) for p in e.get("loc", ()))
            etype = e.get("type", "unknown")
            print(f"LLM_DEBUG loc={loc} type={etype}", file=sys.stderr)
        return
    # JSON parsing failure — print marker only, never raw content.
    if isinstance(exc, json.JSONDecodeError):
        print(f"LLM_DEBUG stage=invalid_json {prefix}", file=sys.stderr)
        return
    # Finish-reason failure — the ValueError message carries the reason.
    if isinstance(exc, ValueError) and str(exc).startswith("finish_reason="):
        reason = str(exc).split("=", 1)[1]
        print(f"LLM_DEBUG stage=finish_reason reason={reason} {prefix}", file=sys.stderr)
        return
    # Transport timeout/connect failures — print class name only.
    if isinstance(exc, _RETRYABLE_TRANSPORT):
        print(
            f"LLM_DEBUG stage=transport error_class={type(exc).__name__} {prefix}", file=sys.stderr
        )
        return
    # Unexpected exception — print class name only.
    print(f"LLM_DEBUG stage=unexpected error_class={type(exc).__name__} {prefix}", file=sys.stderr)


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
