"""
어노테이션 포함 ZIP 임포트 서비스

지원 형식:
  - COCO JSON
      구조 A) images/ + annotations/*.json  (CVAT, Label Studio 등)
      구조 B) train/ val/ test/ 각각에 이미지 + *annotations*.json
              이미지는 split/ 또는 split/images/ 에 위치 가능
              (Roboflow COCO, CVAT per-split 등)
  - YOLO
      data.yaml 또는 classes.txt 로 클래스 정의
      labels/*.txt 로 어노테이션 (cx cy w h 정규화)
      Roboflow 스타일 (train/images/ + train/labels/) 지원
"""
from __future__ import annotations

import io
import json
import os
import zipfile
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Image, Annotation
from app.services.class_service import get_or_create_class
from app.services.file_handler import (
    get_dataset_upload_dir,
    to_relative_path,
    calculate_md5_bytes,
    calculate_phash,
    get_image_dimensions,
    get_file_format,
    SUPPORTED_FORMATS,
)


# ── 형식 자동 감지 ───────────────────────────────────────────────────

def _detect_format(names: list[str]) -> str:
    """
    ZIP 내 파일 목록으로 'coco' / 'yolo' 를 자동 감지합니다.
      - *.json 이 있으면 COCO
      - data.yaml / classes.txt / labels/**/*.txt 가 있으면 YOLO
    """
    lower = [n.lower() for n in names]
    has_json = any(n.endswith(".json") for n in lower)
    has_yaml = any(
        Path(n).name.lower() in ("data.yaml", "dataset.yaml") for n in names
    )
    has_classes_txt = any(Path(n).name.lower() == "classes.txt" for n in names)
    has_label_txt = any(
        n.lower().endswith(".txt") and "label" in n.lower() for n in names
    )
    if has_json:
        return "coco"
    if has_yaml or has_classes_txt or has_label_txt:
        return "yolo"
    return "coco"


# ── COCO 구조 탐지 ───────────────────────────────────────────────────

def _is_image_file(name: str) -> bool:
    return Path(name).suffix.lower() in SUPPORTED_FORMATS


def _find_image_prefix(zf: zipfile.ZipFile, base_dir: str) -> str:
    """
    base_dir 안에서 이미지 파일이 실제로 존재하는 서브 디렉터리를 반환.
    images/ 하위가 있으면 그쪽을 우선 반환, 없으면 base_dir 자체 반환.
    """
    names = zf.namelist()
    # base_dir/images/ 에 이미지가 있는지 확인
    sub = (base_dir.rstrip("/") + "/images/").lstrip("/")
    if any(n.startswith(sub) and _is_image_file(n) for n in names):
        return sub
    # base_dir/ 직접 이미지
    base = (base_dir.rstrip("/") + "/").lstrip("/")
    return base


def _parse_coco_structure(zf: zipfile.ZipFile) -> list[dict]:
    """
    ZIP에서 COCO 구조를 파악하고 {"json": <zip경로>, "image_prefix": <str>} 목록 반환.

    구조 B — 우선 탐지:
        split_dir/*annotation*.json  +  split_dir/ 또는 split_dir/images/ 에 이미지
        split_dir 이름은 무관 (train, val, test, valid, 커스텀 이름 모두 허용)

    구조 A — 폴백:
        annotations/*.json  +  images/  (또는 루트)
    """
    names = zf.namelist()
    json_files = [n for n in names if n.lower().endswith(".json")]

    splits: list[dict] = []

    # ── 구조 B 탐지 ─────────────────────────────────────────────
    # depth-1 JSON: 경로 부분이 정확히 2개 (split_dir/something.json)
    # 그리고 해당 dir 안에 이미지가 있어야 함
    split_json: dict[str, str] = {}   # split_dir -> json_path (첫 번째 우선)
    for j in json_files:
        parts = Path(j).parts
        if len(parts) == 2:
            split_dir = parts[0]
            # "annotation" 이라는 단어가 파일명에 있거나, 일반적인 JSON 파일
            # split_dir 안에 이미지가 있는지 추가 확인
            has_imgs_in_split = any(
                n.startswith(split_dir + "/") and _is_image_file(n) for n in names
            )
            if has_imgs_in_split and split_dir not in split_json:
                split_json[split_dir] = j

    if split_json:
        for split_dir, json_path in split_json.items():
            image_prefix = _find_image_prefix(zf, split_dir)
            splits.append({"json": json_path, "image_prefix": image_prefix})
        return splits

    # ── 구조 A 탐지 ─────────────────────────────────────────────
    # annotations/ 디렉터리 안의 JSON
    anno_jsons = [
        j for j in json_files
        if len(Path(j).parts) >= 2 and Path(j).parts[-2].lower() == "annotations"
    ]
    if not anno_jsons:
        # 루트에 "annotation" 이라는 단어가 있는 JSON
        anno_jsons = [
            j for j in json_files
            if "annotation" in Path(j).name.lower() and len(Path(j).parts) == 1
        ]
    if not anno_jsons:
        # 모든 루트 JSON 시도
        anno_jsons = [j for j in json_files if len(Path(j).parts) == 1]
    if not anno_jsons:
        anno_jsons = json_files[:1]

    for j in anno_jsons:
        parent_parts = Path(j).parts
        if len(parent_parts) >= 2:
            # annotations/xxx.json → 상위 디렉터리의 images/
            base = "/".join(parent_parts[:-2]) if len(parent_parts) > 2 else ""
            image_prefix = _find_image_prefix(zf, base) if base else "images/"
        else:
            # 루트 JSON → images/ 또는 루트 직접
            has_images_dir = any(n.startswith("images/") and _is_image_file(n) for n in names)
            image_prefix = "images/" if has_images_dir else ""
        splits.append({"json": j, "image_prefix": image_prefix})

    return splits


# ── 공용 파일 저장 헬퍼 ─────────────────────────────────────────────

def _save_image_bytes(data: bytes, filename: str, dest_dir: str) -> tuple[str, str]:
    """파일 저장 후 (abs_path, rel_path) 반환."""
    md5_prefix = calculate_md5_bytes(data)[:8]
    safe_name = f"{md5_prefix}_{Path(filename).name}"
    abs_path = os.path.join(dest_dir, safe_name)
    with open(abs_path, "wb") as f:
        f.write(data)
    return abs_path, to_relative_path(abs_path)


# ── COCO 임포터 ─────────────────────────────────────────────────────

async def _import_coco(
    db: AsyncSession,
    dataset_id: int,
    zf: zipfile.ZipFile,
    existing_hashes: set[str],
) -> dict[str, int]:
    """COCO JSON ZIP 임포트. 추가/스킵/에러 카운트 반환."""
    dest_dir = get_dataset_upload_dir(dataset_id)
    splits = _parse_coco_structure(zf)

    added = skipped = errors = 0

    for split in splits:
        json_path: str | None = split.get("json")
        image_prefix: str = split.get("image_prefix", "")

        if not json_path:
            continue

        try:
            coco: dict[str, Any] = json.loads(zf.read(json_path).decode("utf-8"))
        except Exception:
            errors += 1
            continue

        # ── 카테고리 → DB 클래스 매핑 ──
        categories: dict[int, str] = {
            cat["id"]: cat["name"] for cat in coco.get("categories", [])
        }
        class_map: dict[int, int] = {}
        for coco_id, name in categories.items():
            cls = await get_or_create_class(db, dataset_id, name)
            class_map[coco_id] = cls.id

        # ── 이미지 처리 ──────────────────
        # ZIP 내 파일명 소문자 역매핑 (대소문자 불일치 대응)
        lower_map: dict[str, str] = {n.lower(): n for n in zf.namelist()}

        # coco image_id → DB image id (스킵된 이미지 = -1)
        coco_img_id_to_db: dict[int, int] = {}
        # coco image_id → (width, height) — 어노테이션 정규화용
        coco_img_size: dict[int, tuple[int, int]] = {}

        for img_info in coco.get("images", []):
            filename: str = img_info.get("file_name", "")
            coco_img_id: int = img_info["id"]
            coco_w: int = img_info.get("width") or 0
            coco_h: int = img_info.get("height") or 0

            # ZIP 내 경로 탐색 (여러 후보 순서대로)
            stem_name = Path(filename).name
            candidates = [
                image_prefix + filename,
                image_prefix + stem_name,
                filename,
                stem_name,
            ]
            zip_member: str | None = None
            for cp in candidates:
                if cp in zf.namelist():
                    zip_member = cp
                    break
                if cp.lower() in lower_map:
                    zip_member = lower_map[cp.lower()]
                    break

            if zip_member is None:
                errors += 1
                continue

            if Path(zip_member).suffix.lower() not in SUPPORTED_FORMATS:
                errors += 1
                continue

            data = zf.read(zip_member)
            md5 = calculate_md5_bytes(data)

            if md5 in existing_hashes:
                skipped += 1
                coco_img_id_to_db[coco_img_id] = -1
                # 크기 정보는 COCO JSON에서 가져옴 (어노테이션 정규화용)
                coco_img_size[coco_img_id] = (coco_w or 1, coco_h or 1)
                continue

            abs_path, rel_path = _save_image_bytes(data, stem_name, dest_dir)

            # 실제 이미지 크기 (COCO 메타가 없으면 직접 측정)
            if coco_w and coco_h:
                w, h = coco_w, coco_h
            else:
                try:
                    w, h = get_image_dimensions(abs_path)
                except Exception:
                    w, h = 1, 1

            phash = ""
            try:
                phash = calculate_phash(abs_path)
            except Exception:
                pass

            img_obj = Image(
                dataset_id=dataset_id,
                filename=Path(abs_path).name,
                filepath=rel_path,
                width=w, height=h,
                format=get_file_format(abs_path),
                file_hash=md5,
                phash=phash,
            )
            db.add(img_obj)
            await db.flush()   # id 확보

            existing_hashes.add(md5)
            coco_img_id_to_db[coco_img_id] = img_obj.id
            coco_img_size[coco_img_id] = (w, h)
            added += 1

        # ── 어노테이션 처리 ──────────────
        for ann_info in coco.get("annotations", []):
            coco_img_id = ann_info.get("image_id")
            db_img_id = coco_img_id_to_db.get(coco_img_id)
            if db_img_id is None or db_img_id == -1:
                continue

            bbox = ann_info.get("bbox")   # [x_min, y_min, w, h] in pixels
            if not bbox or len(bbox) < 4:
                continue

            coco_cat_id = ann_info.get("category_id")
            db_class_id = class_map.get(coco_cat_id)

            img_w, img_h = coco_img_size.get(coco_img_id, (1, 1))
            x_min_px, y_min_px, w_px, h_px = (float(v) for v in bbox)

            db.add(Annotation(
                image_id=db_img_id,
                class_id=db_class_id,
                annotation_type="bbox",
                bbox_x=x_min_px / img_w,
                bbox_y=y_min_px / img_h,
                bbox_w=w_px / img_w,
                bbox_h=h_px / img_h,
            ))

    await db.flush()
    return {"added": added, "skipped": skipped, "errors": errors}


# ── YOLO 임포터 ─────────────────────────────────────────────────────

def _load_yolo_classes(zf: zipfile.ZipFile) -> list[str]:
    """data.yaml 또는 classes.txt 에서 클래스 이름 목록 반환."""
    names_in_zip = zf.namelist()

    # data.yaml / dataset.yaml 탐색
    for n in names_in_zip:
        if Path(n).name.lower() in ("data.yaml", "dataset.yaml"):
            try:
                import yaml
                raw = yaml.safe_load(zf.read(n).decode("utf-8"))
                if isinstance(raw, dict):
                    cls_names = raw.get("names")
                    if isinstance(cls_names, list):
                        return [str(x) for x in cls_names]
                    if isinstance(cls_names, dict):
                        return [cls_names[k] for k in sorted(cls_names)]
            except Exception:
                pass

    # classes.txt 탐색
    for n in names_in_zip:
        if Path(n).name.lower() == "classes.txt":
            try:
                lines = zf.read(n).decode("utf-8").splitlines()
                return [ln.strip() for ln in lines if ln.strip()]
            except Exception:
                pass

    return []


def _find_label_file(zf: zipfile.ZipFile, img_zip_path: str) -> str | None:
    """
    이미지 ZIP 경로에 대응하는 라벨 txt 파일 경로를 반환.
    예: train/images/img.jpg → train/labels/img.txt
    """
    names_in_zip_set = set(zf.namelist())
    lower_map = {n.lower(): n for n in zf.namelist()}

    stem = Path(img_zip_path).stem
    parts = Path(img_zip_path).parts   # e.g. ('train', 'images', 'img.jpg')

    candidates: list[str] = []

    # Roboflow: train/images/img.jpg → train/labels/img.txt
    if len(parts) >= 3 and parts[-2].lower() == "images":
        split_prefix = "/".join(parts[:-2])
        candidates.append(f"{split_prefix}/labels/{stem}.txt")

    # 단순 labels/ 디렉터리
    candidates += [
        f"labels/{stem}.txt",
        f"labels/train/{stem}.txt",
        f"labels/val/{stem}.txt",
        f"labels/valid/{stem}.txt",
        f"labels/test/{stem}.txt",
    ]
    # split 이름이 있을 때 (e.g. train/img.jpg → train/labels/img.txt)
    if len(parts) >= 2:
        split_prefix = parts[0]
        candidates += [
            f"{split_prefix}/labels/{stem}.txt",
            f"{split_prefix}/{stem}.txt",
        ]
    # 루트
    candidates.append(f"{stem}.txt")

    for c in candidates:
        if c in names_in_zip_set:
            return c
        if c.lower() in lower_map:
            return lower_map[c.lower()]
    return None


async def _import_yolo(
    db: AsyncSession,
    dataset_id: int,
    zf: zipfile.ZipFile,
    existing_hashes: set[str],
) -> dict[str, int]:
    """YOLO 형식 ZIP 임포트."""
    dest_dir = get_dataset_upload_dir(dataset_id)
    class_names = _load_yolo_classes(zf)
    class_db_map: dict[int, int] = {}   # yolo_idx → DB class id

    async def resolve_class(yolo_idx: int) -> int | None:
        if yolo_idx in class_db_map:
            return class_db_map[yolo_idx]
        name = class_names[yolo_idx] if yolo_idx < len(class_names) else f"class_{yolo_idx}"
        cls = await get_or_create_class(db, dataset_id, name)
        class_db_map[yolo_idx] = cls.id
        return cls.id

    # 이미지 파일만 수집 (macOS 숨김 파일 제외)
    image_members = [
        n for n in zf.namelist()
        if _is_image_file(n) and not n.startswith("__MACOSX")
    ]

    added = skipped = errors = 0

    for zip_member in image_members:
        filename = Path(zip_member).name
        suffix = Path(filename).suffix.lower()
        if suffix not in SUPPORTED_FORMATS:
            errors += 1
            continue

        data = zf.read(zip_member)
        md5 = calculate_md5_bytes(data)
        if md5 in existing_hashes:
            skipped += 1
            continue

        abs_path, rel_path = _save_image_bytes(data, filename, dest_dir)
        try:
            w, h = get_image_dimensions(abs_path)
        except Exception:
            w, h = 0, 0

        phash = ""
        try:
            phash = calculate_phash(abs_path)
        except Exception:
            pass

        img_obj = Image(
            dataset_id=dataset_id,
            filename=Path(abs_path).name,
            filepath=rel_path,
            width=w, height=h,
            format=get_file_format(abs_path),
            file_hash=md5,
            phash=phash,
        )
        db.add(img_obj)
        await db.flush()

        existing_hashes.add(md5)
        added += 1

        # 대응 라벨 파일 처리
        label_path = _find_label_file(zf, zip_member)
        if label_path is None:
            continue

        try:
            label_content = zf.read(label_path).decode("utf-8")
        except Exception:
            continue

        for line in label_content.splitlines():
            parts = line.strip().split()
            if len(parts) < 5:
                continue
            try:
                yolo_idx = int(parts[0])
                cx, cy, bw, bh = (float(p) for p in parts[1:5])
            except ValueError:
                continue

            db_class_id = await resolve_class(yolo_idx)
            db.add(Annotation(
                image_id=img_obj.id,
                class_id=db_class_id,
                annotation_type="bbox",
                bbox_x=cx - bw / 2,
                bbox_y=cy - bh / 2,
                bbox_w=bw,
                bbox_h=bh,
            ))

    await db.flush()
    return {"added": added, "skipped": skipped, "errors": errors}


# ── 공개 진입점 ─────────────────────────────────────────────────────

async def import_dataset_zip(
    db: AsyncSession,
    dataset_id: int,
    zip_bytes: bytes,
    force_format: str | None = None,
) -> dict[str, Any]:
    """
    어노테이션 포함 ZIP을 임포트하고 결과 통계를 반환.

    Parameters
    ----------
    force_format : 'coco' | 'yolo' | None
        None이면 ZIP 내용으로 자동 감지
    """
    from sqlalchemy import select

    existing_result = await db.execute(
        select(Image.file_hash).where(Image.dataset_id == dataset_id)
    )
    existing_hashes: set[str] = {row[0] for row in existing_result if row[0]}

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        raise ValueError("유효하지 않은 ZIP 파일입니다.")

    fmt = force_format or _detect_format(zf.namelist())

    if fmt == "coco":
        stats = await _import_coco(db, dataset_id, zf, existing_hashes)
    else:
        stats = await _import_yolo(db, dataset_id, zf, existing_hashes)

    return {"format": fmt, **stats}
