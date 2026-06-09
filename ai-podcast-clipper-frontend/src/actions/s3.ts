"use server";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { v4 as uuidv4 } from "uuid";
import { db } from "~/server/db";

const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

function parseYoutubeUrl(rawUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a valid YouTube URL.");
  }

  const host = parsedUrl.hostname.replace(/^www\./, "");
  let videoId: string | null = null;

  if (host === "youtu.be") {
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    videoId = pathParts[0] ?? null;
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    if (parsedUrl.pathname === "/watch") {
      videoId = parsedUrl.searchParams.get("v");
    } else {
      const [kind, id] = parsedUrl.pathname.split("/").filter(Boolean);
      if (kind === "shorts" || kind === "embed" || kind === "live") {
        videoId = id ?? null;
      }
    }
  }

  if (!videoId || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error("Enter a valid YouTube video URL.");
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export async function generateUploadUrl(fileInfo: {
  filename: string;
  contentType: string;
}): Promise<{
  success: boolean;
  signedUrl: string;
  key: string;
  uploadedFileId: string;
}> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const s3Client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const fileExtension = fileInfo.filename.split(".").pop() ?? "";

  const uniqueId = uuidv4();
  const key = `${uniqueId}/original.${fileExtension}`;

  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: key,
    ContentType: fileInfo.contentType,
  });

  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });

  const uploadedFileDbRecord = await db.uploadedFile.create({
    data: {
      userId: session.user.id,
      s3Key: key,
      displayName: fileInfo.filename,
      uploaded: false,
      sourceType: "upload",
    },
    select: {
      id: true,
    },
  });

  return {
    success: true,
    signedUrl,
    key,
    uploadedFileId: uploadedFileDbRecord.id,
  };
}

export async function createYoutubeIngestionJob(rawUrl: string): Promise<{
  success: boolean;
  uploadedFileId: string;
  key: string;
  videoId: string;
}> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const { canonicalUrl, videoId } = parseYoutubeUrl(rawUrl);
  const uniqueId = uuidv4();
  const key = `${uniqueId}/original.mp4`;

  const uploadedFileDbRecord = await db.uploadedFile.create({
    data: {
      userId: session.user.id,
      s3Key: key,
      displayName: `YouTube ${videoId}`,
      uploaded: false,
      status: "queued",
      sourceType: "youtube",
      sourceUrl: canonicalUrl,
      youtubeVideoId: videoId,
    },
    select: {
      id: true,
    },
  });

  return {
    success: true,
    uploadedFileId: uploadedFileDbRecord.id,
    key,
    videoId,
  };
}
