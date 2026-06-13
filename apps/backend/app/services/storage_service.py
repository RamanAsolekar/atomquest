"""S3-compatible object storage (MinIO locally, AWS S3 in prod) via aioboto3."""
from __future__ import annotations

import aioboto3
from botocore.config import Config

from app.core.config import settings

_session = aioboto3.Session()


def _client():
    return _session.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"}),
    )


async def ensure_buckets() -> None:
    async with _client() as s3:
        for bucket in (settings.s3_bucket_files, settings.s3_bucket_recordings):
            try:
                await s3.head_bucket(Bucket=bucket)
            except Exception:  # noqa: BLE001
                try:
                    await s3.create_bucket(Bucket=bucket)
                except Exception:  # noqa: BLE001
                    pass


async def put_object(bucket: str, key: str, body: bytes, content_type: str) -> str:
    async with _client() as s3:
        await s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)
    return key


async def signed_download_url(bucket: str, key: str, expires_in: int = 900) -> str:
    async with _client() as s3:
        url = await s3.generate_presigned_url(
            "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expires_in
        )
    # rewrite internal endpoint → public endpoint so browsers can reach it
    if settings.s3_endpoint != settings.s3_public_endpoint:
        url = url.replace(settings.s3_endpoint, settings.s3_public_endpoint)
    return url
