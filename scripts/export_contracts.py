"""Regenerate integration artifacts from the actual app and schema."""

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from harvest.api import create_app  # noqa: E402
from harvest.config import Settings  # noqa: E402
from harvest.fixtures import (  # noqa: E402
    OPS_TRANSCRIPT,
    demo_case,
    operations_content,
    tenant_content,
)
from harvest.models import PillContent, PillVersion  # noqa: E402


def write(relative, value):
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


with tempfile.TemporaryDirectory() as directory:
    app = create_app(Settings(database=str(Path(directory) / "schema.db")))
    write("docs/openapi.json", app.openapi())
write("schemas/pill.schema.json", PillContent.model_json_schema())
write("schemas/pill-version.schema.json", PillVersion.model_json_schema())
write("examples/asset-pill.json", operations_content().model_dump(mode="json"))
write("examples/tenant-pill.json", tenant_content().model_dump(mode="json"))
write(
    "examples/expert-capture.json",
    {
        "title": "SYNTHETIC pump-status incident interview",
        "domain": "Asset Operations",
        "transcript": OPS_TRANSCRIPT,
        "synthetic": True,
    },
)
write("examples/operational-case.json", demo_case().model_dump(mode="json"))
print("Exported OpenAPI, portable Pill schema and synthetic request/artifact examples.")
