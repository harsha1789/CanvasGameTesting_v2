import argparse
import statistics
import time
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark YOLO detector latency and detections on one image.")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--conf", type=float, default=0.15)
    parser.add_argument("--runs", type=int, default=20)
    args = parser.parse_args()

    model = YOLO(str(args.model.resolve()))
    image = str(args.image.resolve())

    # warmup
    for _ in range(3):
        model.predict(source=image, conf=args.conf, device="cpu", verbose=False)

    times = []
    counts = []
    for _ in range(args.runs):
        t0 = time.perf_counter()
        results = model.predict(source=image, conf=args.conf, device="cpu", verbose=False)
        dt = (time.perf_counter() - t0) * 1000.0
        times.append(dt)
        c = 0
        for r in results:
            if r.boxes is not None:
                c += len(r.boxes)
        counts.append(c)

    print(f"runs={args.runs} conf={args.conf}")
    print(f"latency_ms mean={statistics.mean(times):.2f} p50={statistics.median(times):.2f} max={max(times):.2f}")
    print(f"detections mean={statistics.mean(counts):.2f} counts={counts}")


if __name__ == "__main__":
    main()

