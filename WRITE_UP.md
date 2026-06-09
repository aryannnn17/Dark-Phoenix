# Dark Phoenix Technical Write-Up

## What Changed

The original Dark Phoenix app was file-upload-first: the browser uploaded an
MP4 to S3, Inngest called the Modal backend with an `s3_key`, and Modal
generated captioned clips back into S3.

This submission keeps that path and adds a production YouTube path:

- The dashboard now accepts YouTube URLs.
- The frontend validates the URL, extracts the YouTube video ID, creates an
  `UploadedFile` record, reserves a UUID-backed `original.mp4` S3 key, and
  sends the existing Inngest event.
- Inngest passes the source URL and video ID to the existing Modal endpoint.
- Modal downloads the YouTube video with `yt-dlp`, uploads the source MP4 to
  the reserved S3 key, then runs the existing WhisperX, Gemini, ASD, ffmpeg,
  and S3 upload pipeline.
- Final clips are named with the assignment format when a YouTube video ID is
  available.
- Modal uploads `clips_manifest.json` beside the clips in S3.
- The frontend reads the manifest after processing and stores clip start/end,
  duration, caption, and watermark metadata.
- The frontend includes `.npmrc` with `legacy-peer-deps=true` so Vercel can
  install the existing React 19 plus `shadcn-dropzone` dependency set.
- Stripe billing is optional for the review deployment; checkout UI is disabled
  when Stripe is not configured and reviewer credits can be seeded directly.
- `scripts/download_delivery_artifacts.py` downloads the S3 manifest and final
  MP4s into a local Google Drive handoff folder.

## Deployment Stack

The intended deployment stack follows the assignment recommendation:

- Vercel for the Next.js frontend.
- Inngest Cloud for the production queue.
- Modal for the GPU backend.
- Supabase Postgres for Prisma data.
- AWS S3 for source videos and generated clips.
- Gemini API for moment selection.
- Stripe test mode or directly seeded reviewer credits.
- Google Drive for final review delivery.

This keeps the original architecture intact and avoids moving GPU processing,
storage, or queueing into new systems.

## YouTube Ingestion

The browser never downloads the YouTube video. The dashboard creates a job and
stores:

- original YouTube URL
- YouTube video ID
- source type
- reserved S3 source key
- processing status and error detail

The Modal backend receives the URL through the normal Inngest processing
request. It downloads with:

```bash
yt-dlp --no-playlist --max-filesize 2500M \
  -f "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b" \
  --merge-output-format mp4 \
  -o /tmp/<run>/input.mp4 \
  "https://www.youtube.com/watch?v=YRvf00NooN8"
```

After download, Modal uploads that file to the reserved S3 key and continues
with the existing processing flow.

## Watermarking

The watermark is burned into the exported MP4 in the backend render path. The
final ffmpeg command applies the ASS caption filter and then `drawtext`:

```text
drawtext=fontfile=/usr/share/fonts/truetype/custom/Anton-Regular.ttf:text='LUNARTECH.AI':fontcolor=white@0.72:fontsize=42:borderw=2:bordercolor=black@0.55:x=w-tw-44:y=44
```

This makes the watermark part of the downloaded file. It is not a CSS or player
overlay.

## What Still Needs Work

- Real cloud credentials are required to complete deployment, process the
  assigned video, upload final clips to Google Drive, and fill the final URLs in
  `DEPLOYMENT.md`.
- Clip moment quality still depends on Gemini's JSON response and the source
  transcript quality. A production version should add stricter JSON validation
  and a fallback moment-selection strategy.
- Job status could be more granular. Today the UI shows queued, processing,
  processed, no credits, and failed; a fuller product would expose downloading,
  transcribing, selecting moments, rendering, and uploading.
- The dashboard uses manual refresh. A production reviewer experience would
  benefit from polling or realtime job updates.
- Google Drive delivery is documented as a final handoff step. A future version
  could automate Drive upload with a service account after clips are generated.

## Final Submission Checklist

Before emailing LUNARTECH:

- Deploy Vercel and Modal.
- Apply the Prisma schema to the deployed Postgres database.
- Configure S3 CORS for the final frontend domain.
- Confirm Inngest can reach `/api/inngest`.
- Seed or create a reviewer account with enough credits.
- Process `https://www.youtube.com/watch?v=YRvf00NooN8`.
- Verify at least three final clips are vertical, captioned, playable, and
  watermarked.
- Upload clips, screenshots, and `clips_manifest.json` to Google Drive.
- Share the private GitHub repo and Drive folder with `tk.lunartech@gmail.com`.
- Tag the exact commit as `submitted`.
