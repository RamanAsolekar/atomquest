#!/usr/bin/env python3
"""faster-whisper streaming worker.

Reads raw 16 kHz mono s16le PCM from stdin (piped from FFmpeg by the media
server), buffers a sliding window, transcribes each window and prints JSON
transcript segments to stdout — one per line:

    {"text": "...", "start": 0.0, "end": 2.9}

Self-hosted: the model runs locally (CPU int8 by default). If faster-whisper is
not installed the worker degrades gracefully to a heartbeat so the media server
keeps running without transcription.
"""
from __future__ import annotations

import argparse
import json
import sys

SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2
WINDOW_SECONDS = 3.0
WINDOW_BYTES = int(SAMPLE_RATE * BYTES_PER_SAMPLE * WINDOW_SECONDS)


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="base.en")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    try:
        import numpy as np
        from faster_whisper import WhisperModel
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"[whisper] dependencies unavailable ({exc}); STT disabled\n")
        # drain stdin so the pipe doesn't block FFmpeg, but produce no output
        while sys.stdin.buffer.read(WINDOW_BYTES):
            pass
        return

    sys.stderr.write(f"[whisper] loading model={args.model} device={args.device}\n")
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)

    elapsed = 0.0
    buf = bytearray()
    while True:
        chunk = sys.stdin.buffer.read(4096)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) < WINDOW_BYTES:
            continue

        window = bytes(buf[:WINDOW_BYTES])
        del buf[:WINDOW_BYTES]
        audio = np.frombuffer(window, dtype=np.int16).astype(np.float32) / 32768.0

        # skip near-silent windows to save CPU
        if float(np.sqrt(np.mean(audio**2))) < 0.005:
            elapsed += WINDOW_SECONDS
            continue

        try:
            segments, _ = model.transcribe(audio, language="en", vad_filter=True, beam_size=1)
            for seg in segments:
                text = seg.text.strip()
                if text:
                    emit({"text": text, "start": elapsed + seg.start, "end": elapsed + seg.end})
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"[whisper] transcribe error: {exc}\n")
        elapsed += WINDOW_SECONDS


if __name__ == "__main__":
    main()
