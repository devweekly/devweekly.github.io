"""Connection helpers for the Snowflake Semantic View lab."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any


IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")


def qualified_schema(value: str) -> str:
    """Validate an unquoted DB.SCHEMA identifier before interpolating into SQL."""
    parts = value.split(".")
    if len(parts) != 2 or not all(IDENTIFIER.fullmatch(part) for part in parts):
        raise ValueError(
            "Target schema must be an unquoted DB.SCHEMA identifier, "
            "for example SV_FINANCE_LAB.MART"
        )
    return ".".join(parts)


def connect_from_env() -> Any:
    """Create a connection without printing credentials or private key material."""
    try:
        import snowflake.connector
    except ImportError as exc:
        raise RuntimeError(
            "Install project requirements first: pip install -r requirements.txt"
        ) from exc

    account = os.environ.get("SNOWFLAKE_ACCOUNT")
    user = os.environ.get("SNOWFLAKE_USER")
    if not account or not user:
        raise RuntimeError("Set SNOWFLAKE_ACCOUNT and SNOWFLAKE_USER first.")

    config: dict[str, Any] = {
        "account": account,
        "user": user,
    }
    for env_name, connector_name in (
        ("SNOWFLAKE_ROLE", "role"),
        ("SNOWFLAKE_WAREHOUSE", "warehouse"),
    ):
        value = os.environ.get(env_name)
        if value:
            config[connector_name] = value

    key_path = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PATH")
    if key_path:
        try:
            from cryptography.hazmat.primitives.serialization import (
                Encoding,
                NoEncryption,
                PrivateFormat,
                load_pem_private_key,
            )
        except ImportError as exc:
            raise RuntimeError(
                "The cryptography package is required for private-key authentication."
            ) from exc

        passphrase = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PASSPHRASE")
        key_bytes = Path(key_path).expanduser().read_bytes()
        private_key = load_pem_private_key(
            key_bytes,
            password=passphrase.encode("utf-8") if passphrase else None,
        )
        config["private_key"] = private_key.private_bytes(
            encoding=Encoding.DER,
            format=PrivateFormat.PKCS8,
            encryption_algorithm=NoEncryption(),
        )
    else:
        # Interactive local development default. For CI, configure an approved
        # non-interactive identity mechanism instead of relying on a browser.
        config["authenticator"] = os.environ.get(
            "SNOWFLAKE_AUTHENTICATOR", "externalbrowser"
        )

    return snowflake.connector.connect(**config)
