import argparse
import random
from pathlib import Path
from typing import List, Tuple

from PIL import Image, ImageEnhance


def load_backgrounds(root: Path) -> List[Path]:
    exts = {".png", ".jpg", ".jpeg", ".webp"}
    files: List[Path] = []
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in exts:
            # Skip tiny templates and generated labels
            if "labels" in p.parts:
                continue
            files.append(p)
    return files


def ensure_dirs(base: Path) -> None:
    for split in ("train", "val"):
        (base / "images" / split).mkdir(parents=True, exist_ok=True)
        (base / "labels" / split).mkdir(parents=True, exist_ok=True)


def pick_bg(bg_files: List[Path], out_size: Tuple[int, int]) -> Image.Image:
    w, h = out_size
    if not bg_files:
        return Image.new("RGB", (w, h), (20, 20, 20))

    for _ in range(10):
        p = random.choice(bg_files)
        try:
            img = Image.open(p).convert("RGB")
        except Exception:
            continue

        # Random crop/resize to final size
        if img.width < w or img.height < h:
            img = img.resize((max(w, img.width), max(h, img.height)))
        x0 = random.randint(0, max(0, img.width - w))
        y0 = random.randint(0, max(0, img.height - h))
        return img.crop((x0, y0, x0 + w, y0 + h))

    return Image.new("RGB", (w, h), (20, 20, 20))


def augment_icon(icon: Image.Image, min_scale: float, max_scale: float) -> Image.Image:
    scale = random.uniform(min_scale, max_scale)
    nw = max(12, int(icon.width * scale))
    nh = max(12, int(icon.height * scale))
    out = icon.resize((nw, nh), resample=Image.Resampling.BICUBIC)

    angle = random.uniform(-12, 12)
    out = out.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)

    # Color/contrast jitter
    if random.random() < 0.8:
        out = ImageEnhance.Brightness(out).enhance(random.uniform(0.75, 1.25))
    if random.random() < 0.8:
        out = ImageEnhance.Contrast(out).enhance(random.uniform(0.75, 1.25))
    return out


def jitter_position(
    image_size: int,
    icon_w: int,
    icon_h: int,
    cls_id: int,
) -> Tuple[int, int]:
    def safe_rand(lo: int, hi: int) -> int:
        if hi < lo:
            return max(0, hi)
        return random.randint(lo, hi)

    # class 0 bet icon: mostly on right-side control rail
    if cls_id == 0:
        x_min = int(image_size * 0.76)
        x_max = image_size - icon_w
        y_min = int(image_size * 0.08)
        y_max = int(image_size * 0.92) - icon_h
        x = safe_rand(max(0, x_min), max(0, x_max))
        y = safe_rand(max(0, y_min), max(0, y_max))
        return x, y

    # class 1 bet window: usually centered-ish overlay
    cx_min = int(image_size * 0.30)
    cx_max = int(image_size * 0.70)
    cy_min = int(image_size * 0.25)
    cy_max = int(image_size * 0.80)
    cx = safe_rand(cx_min, cx_max)
    cy = safe_rand(cy_min, cy_max)
    x = max(0, min(image_size - icon_w, cx - icon_w // 2))
    y = max(0, min(image_size - icon_h, cy - icon_h // 2))
    return x, y


def add_global_noise(img: Image.Image) -> Image.Image:
    out = img
    if random.random() < 0.6:
        out = ImageEnhance.Brightness(out).enhance(random.uniform(0.8, 1.2))
    if random.random() < 0.6:
        out = ImageEnhance.Contrast(out).enhance(random.uniform(0.8, 1.2))
    if random.random() < 0.35:
        out = ImageEnhance.Color(out).enhance(random.uniform(0.7, 1.3))
    return out


def paste_with_alpha(bg: Image.Image, fg: Image.Image, x: int, y: int) -> None:
    if fg.mode != "RGBA":
        fg = fg.convert("RGBA")
    bg.paste(fg, (x, y), fg)


def yolo_box(x: int, y: int, w: int, h: int, iw: int, ih: int) -> str:
    xc = (x + w / 2) / iw
    yc = (y + h / 2) / ih
    wn = w / iw
    hn = h / ih
    return f"{xc:.6f} {yc:.6f} {wn:.6f} {hn:.6f}"


def build_dataset(
    out_dir: Path,
    bg_files: List[Path],
    bet_icon: Image.Image,
    bet_window: Image.Image,
    train_count: int,
    val_count: int,
    image_size: int,
) -> None:
    ensure_dirs(out_dir)
    specs = [("train", train_count), ("val", val_count)]

    for split, count in specs:
        for i in range(count):
            bg = pick_bg(bg_files, (image_size, image_size))
            bg = add_global_noise(bg)
            labels: List[str] = []

            # 12% hard negatives (no icon)
            if random.random() > 0.12:
                n_objs = random.randint(1, 3)
                for _ in range(n_objs):
                    # class 0 = bet icon, class 1 = bet window
                    cls_id = 0 if random.random() < 0.65 else 1
                    base_icon = bet_icon if cls_id == 0 else bet_window
                    icon = augment_icon(
                        base_icon,
                        min_scale=0.35 if cls_id == 0 else 0.18,
                        max_scale=1.45 if cls_id == 0 else 0.85,
                    )

                    x, y = jitter_position(image_size, icon.width, icon.height, cls_id)

                    paste_with_alpha(bg, icon, x, y)
                    labels.append(f"{cls_id} " + yolo_box(x, y, icon.width, icon.height, image_size, image_size))

            img_name = f"{split}_{i:05d}.png"
            lbl_name = f"{split}_{i:05d}.txt"
            img_path = out_dir / "images" / split / img_name
            lbl_path = out_dir / "labels" / split / lbl_name
            bg.save(img_path)
            lbl_path.write_text("\n".join(labels), encoding="utf-8")


def write_data_yaml(out_dir: Path) -> Path:
    data_yaml = out_dir / "data.yaml"
    text = (
        f"path: {out_dir.as_posix()}\n"
        "train: images/train\n"
        "val: images/val\n"
        "names:\n"
        "  0: bet_icon\n"
        "  1: bet_window\n"
    )
    data_yaml.write_text(text, encoding="utf-8")
    return data_yaml


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic YOLO dataset from bet and betwindow icons.")
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--out-dir", type=Path, default=Path("tmp/yolo-bet-dataset"))
    parser.add_argument("--train-count", type=int, default=900)
    parser.add_argument("--val-count", type=int, default=200)
    parser.add_argument("--image-size", type=int, default=640)
    args = parser.parse_args()

    root = args.project_root.resolve()
    out_dir = (root / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    bet_icon_path = root / "reports" / "screenshots" / "bet.png"
    bet_window_path = root / "reports" / "screenshots" / "betwindow.png"
    if not bet_icon_path.exists() or not bet_window_path.exists():
        raise FileNotFoundError("Expected reports/screenshots/bet.png and reports/screenshots/betwindow.png")

    bet_icon = Image.open(bet_icon_path).convert("RGBA")
    bet_window = Image.open(bet_window_path).convert("RGBA")

    bg_dirs = [
        root / "reports",
        root / "screenshots",
        root / "tmp",
    ]
    bg_files: List[Path] = []
    for d in bg_dirs:
        if d.exists():
            bg_files.extend(load_backgrounds(d))

    build_dataset(
        out_dir=out_dir,
        bg_files=bg_files,
        bet_icon=bet_icon,
        bet_window=bet_window,
        train_count=args.train_count,
        val_count=args.val_count,
        image_size=args.image_size,
    )
    data_yaml = write_data_yaml(out_dir)

    print(f"dataset_dir={out_dir}")
    print(f"data_yaml={data_yaml}")
    print(f"backgrounds={len(bg_files)}")


if __name__ == "__main__":
    random.seed(7)
    main()
