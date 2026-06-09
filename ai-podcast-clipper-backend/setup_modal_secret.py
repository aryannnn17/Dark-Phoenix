"""
Create or update the persistent Modal secret used by Dark Phoenix.

Usage:
    python setup_modal_secret.py

The script reads ../.env, maps PROCESS_VIDEO_ENDPOINT_AUTH to the backend's
AUTH_TOKEN, and runs:
    modal secret create --force --from-json <tempfile> ai-podcast-clipper-secret
"""

import json
import os
import pathlib
import subprocess
import tempfile

from dotenv import load_dotenv


SECRET_NAME = "ai-podcast-clipper-secret"
ENV_PATH = pathlib.Path(__file__).resolve().parent.parent / ".env"
SECRET_KEYS = {
    "GEMINI_API_KEY": "GEMINI_API_KEY",
    "AUTH_TOKEN": "PROCESS_VIDEO_ENDPOINT_AUTH",
    "AWS_ACCESS_KEY_ID": "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY": "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION": "AWS_REGION",
    "S3_BUCKET_NAME": "S3_BUCKET_NAME",
}


def load_secret_values():
    load_dotenv(ENV_PATH)

    values = {
        secret_key: os.getenv(env_key)
        for secret_key, env_key in SECRET_KEYS.items()
    }
    missing = [key for key, value in values.items() if not value]

    if missing:
        missing_list = ", ".join(missing)
        raise SystemExit(
            f"Missing required values for Modal secret: {missing_list}. "
            f"Fill {ENV_PATH} before running this script."
        )

    return values


def main():
    values = load_secret_values()

    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        suffix=".json",
        delete=False,
    ) as temp_file:
        json.dump(values, temp_file)
        temp_file_path = temp_file.name

    try:
        subprocess.run(
            [
                "modal",
                "secret",
                "create",
                "--force",
                "--from-json",
                temp_file_path,
                SECRET_NAME,
            ],
            check=True,
        )
    finally:
        pathlib.Path(temp_file_path).unlink(missing_ok=True)

    print(f"Created or updated Modal secret: {SECRET_NAME}")
    print("Loaded keys:")
    for key in values:
        print(f"  - {key}: set")


if __name__ == "__main__":
    main()
