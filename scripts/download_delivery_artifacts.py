import argparse
import json
import os
import pathlib
from typing import Any

import boto3
from dotenv import load_dotenv


REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_ENV_PATH = REPO_ROOT / ".env"


def load_manifest_from_s3(s3_client, bucket: str, key: str) -> dict[str, Any]:
    response = s3_client.get_object(Bucket=bucket, Key=key)
    body = response["Body"].read().decode("utf-8")
    return json.loads(body)


def list_clip_keys(s3_client, bucket: str, prefix: str) -> list[str]:
    paginator = s3_client.get_paginator("list_objects_v2")
    keys: list[str] = []

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            key = item["Key"]
            if (
                key.endswith(".mp4")
                and not key.endswith("original.mp4")
                and "/original." not in key
            ):
                keys.append(key)

    return sorted(keys)


def build_manifest_from_s3_keys(
    source_url: str | None,
    source_video_id: str | None,
    source_s3_key: str | None,
    clip_keys: list[str],
) -> dict[str, Any]:
    return {
        "source_video_url": source_url,
        "source_video_id": source_video_id,
        "source_s3_key": source_s3_key,
        "watermark_text": "LUNARTECH.AI",
        "clips": [
            {
                "filename": pathlib.PurePosixPath(key).name,
                "source_video_url": source_url,
                "source_video_id": source_video_id,
                "start": None,
                "end": None,
                "duration": None,
                "s3_key": key,
                "captions_present": True,
                "watermark_present": True,
                "watermark_text": "LUNARTECH.AI",
                "known_issue": "Manifest was rebuilt from S3 keys; timestamps were not available.",
            }
            for key in clip_keys
        ],
    }


def download_artifacts(
    manifest: dict[str, Any],
    s3_client,
    bucket: str,
    output_dir: pathlib.Path,
):
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = output_dir / "clips_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    for index, clip in enumerate(manifest.get("clips", []), start=1):
        s3_key = clip.get("s3_key")
        if not s3_key:
            continue

        filename = clip.get("filename") or pathlib.PurePosixPath(s3_key).name
        if not filename:
            filename = f"clip_{index:02d}_lunartech.mp4"

        destination = output_dir / filename
        print(f"Downloading s3://{bucket}/{s3_key} -> {destination}")
        s3_client.download_file(bucket, s3_key, str(destination))


def main():
    parser = argparse.ArgumentParser(
        description="Download final Dark Phoenix clips and manifest from S3 for Google Drive delivery."
    )
    parser.add_argument(
        "--prefix",
        help="S3 folder prefix that contains clips_manifest.json and generated clips.",
    )
    parser.add_argument(
        "--manifest-key",
        help="Explicit S3 key for clips_manifest.json. Overrides --prefix manifest lookup.",
    )
    parser.add_argument(
        "--output-dir",
        default="delivery/YRvf00NooN8",
        help="Local folder for Drive-ready artifacts.",
    )
    parser.add_argument(
        "--source-url",
        default="https://www.youtube.com/watch?v=YRvf00NooN8",
        help="Source video URL used if a manifest has to be rebuilt from S3 keys.",
    )
    parser.add_argument(
        "--source-video-id",
        default="YRvf00NooN8",
        help="Source video ID used if a manifest has to be rebuilt from S3 keys.",
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_PATH),
        help="Path to .env containing AWS_REGION and S3_BUCKET_NAME.",
    )
    args = parser.parse_args()

    if not args.prefix and not args.manifest_key:
        raise SystemExit("Provide --prefix or --manifest-key.")

    load_dotenv(args.env_file)
    bucket = os.environ["S3_BUCKET_NAME"]
    s3_client = boto3.client("s3", region_name=os.getenv("AWS_REGION"))

    manifest_key = args.manifest_key
    if not manifest_key and args.prefix:
        manifest_key = f"{args.prefix.rstrip('/')}/clips_manifest.json"

    try:
        manifest = load_manifest_from_s3(s3_client, bucket, manifest_key)
    except Exception:
        if not args.prefix:
            raise

        clip_keys = list_clip_keys(s3_client, bucket, args.prefix.rstrip("/"))
        manifest = build_manifest_from_s3_keys(
            args.source_url,
            args.source_video_id,
            f"{args.prefix.rstrip('/')}/original.mp4",
            clip_keys,
        )

    download_artifacts(manifest, s3_client, bucket, pathlib.Path(args.output_dir))
    print(f"Delivery artifacts written to {args.output_dir}")


if __name__ == "__main__":
    main()
