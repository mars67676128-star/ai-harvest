import json
import os
from dataclasses import dataclass, field

from .models import Actor


def demo_tokens():
    return {
        f"demo-{role}": Actor(id=role, roles=[role])
        for role in ("expert", "reviewer", "approver", "operator", "viewer")
    }


@dataclass
class Settings:
    database: str = "data/harvest.db"
    environment: str = "demo"
    provider: str = "mock"
    base_url: str = "https://tokenhub-intl.tencentcloudmaas.com/v1"
    model: str = ""
    api_key: str = ""
    timeout: float = 60
    tokens: dict[str, Actor] = field(default_factory=demo_tokens)
    cors_origins: list[str] = field(
        default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"]
    )

    def __post_init__(self):
        if self.environment not in ("demo", "production"):
            raise ValueError("HARVEST_ENV must be demo or production")
        if not self.tokens or any(not token for token in self.tokens):
            raise ValueError("At least one nonempty authentication token is required")
        if self.environment == "production" and any(
            len(t) < 32 or t.startswith("demo-") for t in self.tokens
        ):
            raise ValueError(
                "Production requires explicit random auth tokens of at least 32 characters"
            )
        if self.provider not in ("mock", "tencent", "compatible"):
            raise ValueError("Unknown LLM provider")
        if self.provider != "mock" and (not self.api_key or not self.model):
            raise ValueError("Live providers require HARVEST_LLM_API_KEY and HARVEST_LLM_MODEL")
        if self.provider != "mock" and not self.base_url.startswith("https://"):
            raise ValueError("Live provider transport must use HTTPS")
        # Detect duplicate configured actor IDs deterministically
        seen_ids = set()
        for actor in self.tokens.values():
            if actor.id in seen_ids:
                raise ValueError(f"Duplicate configured actor ID: {actor.id}")
            seen_ids.add(actor.id)

    @classmethod
    def from_env(cls):
        token_json = os.getenv("HARVEST_AUTH_TOKENS")
        environment = os.getenv("HARVEST_ENV", "demo")
        if environment == "production" and not token_json:
            raise ValueError("HARVEST_AUTH_TOKENS is required in production")
        return cls(
            database=os.getenv("HARVEST_DB", "data/harvest.db"),
            environment=environment,
            provider=os.getenv("HARVEST_LLM_PROVIDER", "mock"),
            base_url=os.getenv(
                "HARVEST_LLM_BASE_URL", "https://tokenhub-intl.tencentcloudmaas.com/v1"
            ),
            model=os.getenv("HARVEST_LLM_MODEL", ""),
            api_key=os.getenv("HARVEST_LLM_API_KEY", ""),
            timeout=float(os.getenv("HARVEST_LLM_TIMEOUT", "60")),
            tokens={k: Actor.model_validate(v) for k, v in json.loads(token_json).items()}
            if token_json
            else demo_tokens(),
            cors_origins=os.getenv(
                "HARVEST_CORS_ORIGINS", "http://localhost:3000,http://localhost:5173"
            ).split(","),
        )
