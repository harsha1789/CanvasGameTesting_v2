import argparse
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description="Run YOLO detector on a canvas screenshot.")
    parser.add_argument("--model", type=Path, required=True, help="Path to trained best.pt")
    parser.add_argument("--image", type=Path, required=True, help="Canvas image path")
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--out", type=Path, default=Path("tmp/yolo-detect"))
    args = parser.parse_args()

    model = YOLO(str(args.model.resolve()))
    results = model.predict(
        source=str(args.image.resolve()),
        conf=args.conf,
        save=True,
        project=str(args.out.resolve()),
        name="predict",
        exist_ok=True,
        device="cpu",
        verbose=False,
    )

    out_img = args.out.resolve() / "predict" / args.image.name
    print(f"annotated_image={out_img}")
    for r in results:
        if r.boxes is None:
            continue
        for b in r.boxes:
            cls_id = int(b.cls.item())
            conf = float(b.conf.item())
            x1, y1, x2, y2 = [float(v) for v in b.xyxy.tolist()[0]]
            print(
                f"detection class={cls_id} conf={conf:.3f} "
                f"x1={x1:.1f} y1={y1:.1f} x2={x2:.1f} y2={y2:.1f}"
            )


if __name__ == "__main__":
    main()

