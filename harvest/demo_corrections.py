"""Synthetic correction strings accepted by the deterministic offline demo provider."""

BACKFLOW_REVISED_TEXT = (
    "SYNTHETIC CORRECTION: A flat water trend can hide drain backflow. Require an explicit "
    "verified drain_backflow observation before applying the exception; do not infer backflow "
    "from a flat trend alone. If drain_backflow is missing or unverified, abstain and require "
    "qualified verification. If verified backflow is present, escalate to the duty facilities "
    "engineer and block routine monitoring as the sole response, even when water is not rising."
)
