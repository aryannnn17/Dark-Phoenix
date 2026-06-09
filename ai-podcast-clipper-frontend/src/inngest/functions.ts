import { env } from "~/env";
import { inngest } from "./client";
import { db } from "~/server/db";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

type ClipManifest = {
  source_video_url?: string | null;
  source_video_id?: string | null;
  clips?: {
    filename?: string;
    s3_key?: string;
    start?: number;
    end?: number;
    duration?: number;
    captions_present?: boolean;
    watermark_present?: boolean;
    watermark_text?: string;
    known_issue?: string | null;
  }[];
};

export const processVideo = inngest.createFunction(
  {
    id: "process-video",
    retries: 1,
    concurrency: {
      limit: 1,
      key: "event.data.userId",
    },
  },
  { event: "process-video-events" },
  async ({ event, step }) => {
    const { uploadedFileId } = event.data as {
      uploadedFileId: string;
      userId: string;
      sourceUrl?: string | null;
      youtubeVideoId?: string | null;
    };

    try {
      const { userId, credits, s3Key, sourceUrl, youtubeVideoId } =
        await step.run("check-credits", async () => {
          const uploadedFile = await db.uploadedFile.findUniqueOrThrow({
            where: {
              id: uploadedFileId,
            },
            select: {
              user: {
                select: {
                  id: true,
                  credits: true,
                },
              },
              s3Key: true,
              sourceUrl: true,
              youtubeVideoId: true,
            },
          });

          return {
            userId: uploadedFile.user.id,
            credits: uploadedFile.user.credits,
            s3Key: uploadedFile.s3Key,
            sourceUrl: uploadedFile.sourceUrl,
            youtubeVideoId: uploadedFile.youtubeVideoId,
          };
        });

      if (credits > 0) {
        await step.run("set-status-processing", async () => {
          await db.uploadedFile.update({
            where: {
              id: uploadedFileId,
            },
            data: {
              status: "processing",
              errorMessage: null,
            },
          });
        });

        const response = await step.fetch(env.PROCESS_VIDEO_ENDPOINT, {
          method: "POST",
          body: JSON.stringify({
            s3_key: s3Key,
            source_url: sourceUrl,
            source_video_id: youtubeVideoId,
          }),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.PROCESS_VIDEO_ENDPOINT_AUTH}`,
          },
        });

        if (!response.ok) {
          const responseBody = await response.text().catch(() => "");
          throw new Error(
            `Modal processing failed with status ${response.status}${responseBody ? `: ${responseBody.slice(0, 500)}` : ""}`,
          );
        }

        const { clipsFound } = await step.run(
          "create-clips-in-db",
          async () => {
            const folderPrefix = s3Key.split("/")[0]!;
            const manifestS3Key = `${folderPrefix}/clips_manifest.json`;

            const allKeys = await listS3ObjectsByPrefix(folderPrefix);
            const manifest = await getClipManifest(manifestS3Key);

            const manifestOrder = new Map(
              manifest?.clips
                ?.map((clip, index) => [clip.s3_key, index] as const)
                .filter(([key]) => Boolean(key)) ?? [],
            );
            const clipKeys = allKeys
              .filter(
                (key): key is string =>
                  key !== undefined &&
                  !key.endsWith("original.mp4") &&
                  !key.endsWith("clips_manifest.json"),
              )
              .sort((a, b) => {
                const aOrder = manifestOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
                const bOrder = manifestOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
                return aOrder === bOrder ? a.localeCompare(b) : aOrder - bOrder;
              });

            await db.clip.deleteMany({
              where: {
                uploadedFileId,
              },
            });

            if (clipKeys.length > 0) {
              await db.clip.createMany({
                data: clipKeys.map((clipKey) => {
                  const manifestClip = manifest?.clips?.find(
                    (clip) => clip.s3_key === clipKey,
                  );

                  return {
                    s3Key: clipKey,
                    filename: manifestClip?.filename,
                    startTime: manifestClip?.start,
                    endTime: manifestClip?.end,
                    duration: manifestClip?.duration,
                    captionsPresent: manifestClip?.captions_present ?? false,
                    watermarkPresent: manifestClip?.watermark_present ?? false,
                    watermarkText: manifestClip?.watermark_text,
                    knownIssue: manifestClip?.known_issue,
                    uploadedFileId,
                    userId,
                  };
                }),
              });
            }

            await db.uploadedFile.update({
              where: {
                id: uploadedFileId,
              },
              data: {
                manifestS3Key: manifest ? manifestS3Key : null,
              },
            });

            return { clipsFound: clipKeys.length };
          },
        );

        await step.run("deduct-credits", async () => {
          await db.user.update({
            where: {
              id: userId,
            },
            data: {
              credits: {
                decrement: Math.min(credits, clipsFound),
              },
            },
          });
        });

        await step.run("set-status-processed", async () => {
          await db.uploadedFile.update({
            where: {
              id: uploadedFileId,
            },
            data: {
              status: "processed",
              errorMessage: null,
            },
          });
        });
      } else {
        await step.run("set-status-no-credits", async () => {
          await db.uploadedFile.update({
            where: {
              id: uploadedFileId,
            },
            data: {
              status: "no credits",
            },
          });
        });
      }
    } catch (error: unknown) {
      await db.uploadedFile.update({
        where: {
          id: uploadedFileId,
        },
        data: {
          status: "failed",
          errorMessage:
            error instanceof Error ? error.message : "Unknown processing error",
        },
      });
      throw error;
    }
  },
);

async function listS3ObjectsByPrefix(prefix: string) {
  const s3Client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const listCommand = new ListObjectsV2Command({
    Bucket: env.S3_BUCKET_NAME,
    Prefix: prefix,
  });

  const response = await s3Client.send(listCommand);
  return response.Contents?.map((item) => item.Key).filter(Boolean) ?? [];
}

async function getClipManifest(s3Key: string): Promise<ClipManifest | null> {
  const s3Client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET_NAME,
        Key: s3Key,
      }),
    );
    const body = await response.Body?.transformToString();
    return body ? (JSON.parse(body) as ClipManifest) : null;
  } catch {
    return null;
  }
}
