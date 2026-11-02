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
    base_url: str = "https://api.openai.com/v1"
    model: str = "gpt-6-luna"
    api_key: str = ""
    timeout: float = 60
    reasoning_effort: str = "high"
    tokens: dict[str, Actor] = field(default_factory=demo_tokens)
    cors_origins: list[str] = field(
        default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"]
    )
    expert_directory: list[dict] = field(default_factory=list)
    knowledge_owners: list[dict] = field(default_factory=list)
    sifu_max_knowledge_items: int = 20

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
        if self.provider not in ("mock", "openai", "compatible"):
            raise ValueError("Unknown LLM provider")
        if self.provider != "mock" and (not self.api_key or not self.model):
            raise ValueError("Live providers require HARVEST_LLM_API_KEY and HARVEST_LLM_MODEL")
        if self.provider != "mock" and not self.base_url.startswith("https://"):
            raise ValueError("Live provider transport must use HTTPS")
        if self.provider == "openai" and not self.base_url.startswith("https://api.openai.com/"):
            raise ValueError("OpenAI provider must use https://api.openai.com/")
        if self.reasoning_effort not in ("none", "low", "medium", "high", "xhigh", "max"):
            raise ValueError(
                "HARVEST_LLM_REASONING_EFFORT must be none, low, medium, high, xhigh or max"
            )
        if not 1 <= self.sifu_max_knowledge_items <= 100:
            raise ValueError("SIFU_MAX_KNOWLEDGE_ITEMS must be between 1 and 100")
        if not isinstance(self.expert_directory, list):
            raise ValueError("SIFU_EXPERT_DIRECTORY must decode to a JSON list")
        seen_experts = set()
        for entry in self.expert_directory:
            if not isinstance(entry, dict):
                raise ValueError("Each SIFU expert directory entry must be a JSON object")
            required = {"id", "name", "role", "skills"}
            if not required <= entry.keys():
                raise ValueError("Each SIFU expert entry requires id, name, role and skills")
            if not all(
                isinstance(entry[key], str) and entry[key].strip() for key in ("id", "name", "role")
            ):
                raise ValueError("SIFU expert id, name and role must be nonempty strings")
            if not isinstance(entry["skills"], list) or not all(
                isinstance(skill, str) and skill.strip() for skill in entry["skills"]
            ):
                raise ValueError("SIFU expert skills must be a list of nonempty strings")
            domains = entry.get("domains", [])
            if not isinstance(domains, list) or not all(
                isinstance(domain, str) and domain.strip() for domain in domains
            ):
                raise ValueError("SIFU expert domains must be a list of nonempty strings")
            if entry["id"] in seen_experts:
                raise ValueError(f"Duplicate SIFU expert id: {entry['id']}")
            seen_experts.add(entry["id"])

        if not isinstance(self.knowledge_owners, list):
            raise ValueError("SIFU_KNOWLEDGE_OWNERS must decode to a JSON list")
        seen_owner_ids = set()
        owned_domains = set()
        for entry in self.knowledge_owners:
            if not isinstance(entry, dict):
                raise ValueError("Each SIFU knowledge owner entry must be a JSON object")
            required = {"id", "name", "domains"}
            if not required <= entry.keys():
                raise ValueError("Each SIFU knowledge owner requires id, name and domains")
            if not all(
                isinstance(entry[key], str) and entry[key].strip() for key in ("id", "name")
            ):
                raise ValueError("SIFU knowledge owner id and name must be nonempty strings")
            if (
                not isinstance(entry["domains"], list)
                or not entry["domains"]
                or not all(
                    isinstance(domain, str) and domain.strip() for domain in entry["domains"]
                )
            ):
                raise ValueError("SIFU knowledge owner domains must be a nonempty string list")
            if entry["id"] in seen_owner_ids:
                raise ValueError(f"Duplicate SIFU knowledge owner id: {entry['id']}")
            overlap = owned_domains.intersection(entry["domains"])
            if overlap:
                raise ValueError(f"SIFU domain has multiple Knowledge Owners: {sorted(overlap)[0]}")
            seen_owner_ids.add(entry["id"])
            owned_domains.update(entry["domains"])

        # Detect duplicate configured actor IDs deterministically.
        seen_ids = set()
        actors_by_id = {}
        for actor in self.tokens.values():
            if actor.id in seen_ids:
                raise ValueError(f"Duplicate configured actor ID: {actor.id}")
            seen_ids.add(actor.id)
            actors_by_id[actor.id] = actor

        for owner in self.knowledge_owners:
            actor = actors_by_id.get(owner["id"])
            if actor is None:
                raise ValueError(f"SIFU knowledge owner '{owner['id']}' is not a configured actor")
            if "approver" not in actor.roles:
                raise ValueError(f"SIFU knowledge owner '{owner['id']}' requires the approver role")

    @classmethod
    def from_env(cls):
        token_json = os.getenv("HARVEST_AUTH_TOKENS")
        expert_json = os.getenv("SIFU_EXPERT_DIRECTORY", "[]")
        owner_json = os.getenv("SIFU_KNOWLEDGE_OWNERS", "[]")
        environment = os.getenv("HARVEST_ENV", "demo")
        if environment == "production" and not token_json:
            raise ValueError("HARVEST_AUTH_TOKENS is required in production")
        return cls(
            database=os.getenv("HARVEST_DB", "data/harvest.db"),
            environment=environment,
            provider=os.getenv("HARVEST_LLM_PROVIDER", "mock"),
            base_url=os.getenv("HARVEST_LLM_BASE_URL", "https://api.openai.com/v1"),
            model=os.getenv("HARVEST_LLM_MODEL", "gpt-6-luna"),
            api_key=os.getenv("HARVEST_LLM_API_KEY", ""),
            timeout=float(os.getenv("HARVEST_LLM_TIMEOUT", "60")),
            reasoning_effort=os.getenv("HARVEST_LLM_REASONING_EFFORT", "high"),
            tokens={k: Actor.model_validate(v) for k, v in json.loads(token_json).items()}
            if token_json
            else demo_tokens(),
            cors_origins=os.getenv(
                "HARVEST_CORS_ORIGINS", "http://localhost:3000,http://localhost:5173"
            ).split(","),
            expert_directory=json.loads(expert_json),
            knowledge_owners=json.loads(owner_json),
            sifu_max_knowledge_items=int(os.getenv("SIFU_MAX_KNOWLEDGE_ITEMS", "20")),
        )
