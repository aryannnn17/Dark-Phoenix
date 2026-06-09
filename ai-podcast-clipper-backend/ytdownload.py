import argparse
import pathlib
import subprocess


def download_youtube_video(url: str, output_path: pathlib.Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "yt-dlp",
        "--no-playlist",
        "--max-filesize",
        "2500M",
        "-f",
        "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b",
        "--merge-output-format",
        "mp4",
        "-o",
        str(output_path),
        url,
    ]
    subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser(
        description="Download a YouTube video as an MP4 for Dark Phoenix diagnostics."
    )
    parser.add_argument("url", help="YouTube URL to download")
    parser.add_argument(
        "--output",
        default="output_1080p.mp4",
        help="Output MP4 path. Defaults to output_1080p.mp4.",
    )
    args = parser.parse_args()

    download_youtube_video(args.url, pathlib.Path(args.output))
    print(f"Downloaded {args.url} to {args.output}")


if __name__ == "__main__":
    main()
