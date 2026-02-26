import argparse
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Train YOLO detector for bet icon + bet window.")
    parser.add_argument("--data", type=Path, default=Path("tmp/yolo-bet-dataset/data.yaml"))
    parser.add_argument("--model", type=str, default="yolov8n.pt")
    parser.add_argument("--epochs", type=int, default=35)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--project", type=Path, default=Path("tmp/yolo-runs"))
    parser.add_argument("--name", type=str, default="bet_detector")
    parser.add_argument("--config-dir", type=Path, default=Path("tmp/ultralytics-settings"))
    args = parser.parse_args()

    data = args.data.resolve()
    if not data.exists():
        raise FileNotFoundError(f"Missing dataset yaml: {data}")

    # Ultralytics tries to write under roaming profile by default. Force workspace-local paths.
    cfg_dir = args.config_dir.resolve()
    cfg_dir.mkdir(parents=True, exist_ok=True)
    os.environ["YOLO_CONFIG_DIR"] = str(cfg_dir)
    os.environ["ULTRALYTICS_SETTINGS_DIR"] = str(cfg_dir)
    os.environ["TMPDIR"] = str((Path.cwd() / "tmp").resolve())

    from ultralytics import YOLO

    model = YOLO(args.model)
    model.train(
        data=str(data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=str(args.project.resolve()),
        name=args.name,
        workers=0,
        pretrained=True,
        device="cpu",
    )

    best = args.project.resolve() / args.name / "weights" / "best.pt"
    print(f"best_model={best}")


if __name__ == "__main__":
    main()
