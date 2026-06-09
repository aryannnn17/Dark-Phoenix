# Dark Phoenix Deployment Guide

This deployment keeps the original Dark Phoenix architecture: Next.js on Vercel,
Inngest Cloud for queueing, Modal for GPU processing, Postgres for app state,
AWS S3 for source and generated media, and Google Drive for final review
delivery.

## Deployment URLs

Fill these after deployment:

| Item | Value |
| --- | --- |
| Frontend URL | `https://YOUR_PROJECT.vercel.app` |
| Modal endpoint | `https://YOUR_MODAL_ENDPOINT.modal.run` |
| Google Drive folder | `https://drive.google.com/...` |
| Submitted tag | `submitted` |

## Environment Variables

Set these in Vercel. Also keep the same values in the local root `.env` for
development and for `setup_modal_secret.py`.

| Variable | Where | Notes |
| --- | --- | --- |
| `AUTH_SECRET` | Vercel | Generate with `npx auth secret`. |
| `DATABASE_URL` | Vercel | Supabase or another Postgres-compatible URL. |
| `AWS_ACCESS_KEY_ID` | Vercel, Modal secret | S3 access key. |
| `AWS_SECRET_ACCESS_KEY` | Vercel, Modal secret | S3 secret key. |
| `AWS_REGION` | Vercel, Modal secret | Bucket region. |
| `S3_BUCKET_NAME` | Vercel, Modal secret | Private media bucket. |
| `PROCESS_VIDEO_ENDPOINT` | Vercel | Modal `process_video` endpoint URL. |
| `PROCESS_VIDEO_ENDPOINT_AUTH` | Vercel | Must match Modal `AUTH_TOKEN`. |
| `AUTH_TOKEN` | Modal secret | Bearer token checked by Modal. |
| `GEMINI_API_KEY` | Modal secret | Used for moment selection. |
| `STRIPE_SECRET_KEY` | Vercel | Test mode is acceptable. |
| `STRIPE_WEBHOOK_SECRET` | Vercel | Test webhook secret. |
| `STRIPE_SMALL_CREDIT_PACK` | Vercel | Test price ID. |
| `STRIPE_MEDIUM_CREDIT_PACK` | Vercel | Test price ID. |
| `STRIPE_LARGE_CREDIT_PACK` | Vercel | Test price ID. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Vercel | Test publishable key. |
| `BASE_URL` | Vercel | The deployed frontend URL. |

Do not commit real secrets.

## Database

1. Create a Supabase Postgres project.
2. Set `DATABASE_URL`.
3. Apply the schema:

```bash
cd ai-podcast-clipper-frontend
npm install
npm run db:push
```

Create a reviewer credentials account through the app signup flow or Prisma
Studio, then set enough credits for the assigned run. Include the reviewer
login only in the submission email.

## S3

Use a private bucket with block public access enabled. Configure CORS for the
deployed frontend domain:

```json
[
  {
    "AllowedHeaders": ["Content-Type", "Content-Length", "Authorization"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["https://YOUR_PROJECT.vercel.app"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The frontend uses signed PUT/GET URLs for direct upload and playback. The Modal
backend uses the same bucket to download source files, upload generated clips,
and upload `clips_manifest.json`.

## Modal Backend

```bash
cd ai-podcast-clipper-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
modal setup
python setup_modal_secret.py
modal deploy main.py
```

`setup_modal_secret.py` creates or updates the persistent
`ai-podcast-clipper-secret` from the root `.env`. Copy the printed
`process_video` endpoint into `PROCESS_VIDEO_ENDPOINT`.
`PROCESS_VIDEO_ENDPOINT_AUTH` in Vercel must equal `AUTH_TOKEN` in the Modal
secret.

Smoke test with an existing S3 source key:

```bash
curl -X POST "$PROCESS_VIDEO_ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PROCESS_VIDEO_ENDPOINT_AUTH" \
  -d '{"s3_key":"some-folder/original.mp4"}'
```

For YouTube jobs, the frontend sends `source_url` and `source_video_id` to
Modal through Inngest. Modal downloads the video with `yt-dlp`, uploads it to
the reserved `original.mp4` S3 key, then runs transcription, moment selection,
reframing, captions, watermarking, clip upload, and manifest upload.

## Inngest

1. Create an Inngest Cloud app.
2. Connect it to the Vercel project or set `INNGEST_EVENT_KEY` and
   `INNGEST_SIGNING_KEY` if required by your Inngest setup.
3. Verify Inngest can reach `https://YOUR_PROJECT.vercel.app/api/inngest`.
4. Keep the per-user concurrency limit at `1`.
5. Trigger a test job and verify the run history reaches the Modal step.

## Frontend

Recommended Vercel settings:

| Setting | Value |
| --- | --- |
| Framework | Next.js |
| Root directory | `ai-podcast-clipper-frontend` |
| Install command | `npm install` |
| Build command | `npm run build` |
| Development command | `npm run dev` |
| Node version | 20+ |

The frontend includes `.npmrc` with `legacy-peer-deps=true` because the existing
`shadcn-dropzone` package declares a React 18 peer range while this app uses
React 19.

After setting or changing environment variables, redeploy the project.

## Assigned Video Reproduction

1. Log in as the reviewer/test account.
2. Open `/dashboard`.
3. Submit `https://www.youtube.com/watch?v=YRvf00NooN8` in the YouTube URL
   field.
4. Refresh the queue until the job status is `Processed`.
5. Open the clips tab and verify playback/download.
6. Download the final S3 artifacts into a Drive-ready local folder:

```bash
python scripts/download_delivery_artifacts.py --prefix S3_JOB_FOLDER_PREFIX
```

   The prefix is the UUID folder before `/original.mp4` in the job's S3 key.
   The command writes clips and `clips_manifest.json` into
   `delivery/YRvf00NooN8`.

7. Upload the final clips to Google Drive using these names:
   - `dark-phoenix_YRvf00NooN8_clip_01_lunartech.mp4`
   - `dark-phoenix_YRvf00NooN8_clip_02_lunartech.mp4`
   - `dark-phoenix_YRvf00NooN8_clip_03_lunartech.mp4`
8. Upload `delivery/YRvf00NooN8/clips_manifest.json`.
9. Share the Drive folder with `tk.lunartech@gmail.com` or set it to
   "Anyone with the link can view".

## Watermark Implementation

The watermark is burned into the final MP4 in
`ai-podcast-clipper-backend/main.py` inside `create_subtitles_with_ffmpeg`.
The ffmpeg video filter applies ASS captions and then:

```text
drawtext=fontfile=/usr/share/fonts/truetype/custom/Anton-Regular.ttf:text='LUNARTECH.AI':fontcolor=white@0.72:fontsize=42:borderw=2:bordercolor=black@0.55:x=w-tw-44:y=44
```

This places a small upper-right `LUNARTECH.AI` mark into the encoded video, not
a web-player overlay.

## Known Limitations

- Deployment requires real Vercel, Modal, AWS, Supabase, Gemini, Inngest, and
  Stripe test credentials.
- YouTube availability can change. If `YRvf00NooN8` becomes unavailable,
  record the exact `yt-dlp` error and demonstrate the same pipeline on a
  comparable fallback video.
- Billing can use Stripe test mode, or the reviewer account can be seeded with
  credits directly and documented in the submission email.
