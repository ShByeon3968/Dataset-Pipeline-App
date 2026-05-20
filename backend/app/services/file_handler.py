"""
파일 업로드 · 저장 · 해시 처리 서비스

경로 정책
---------
DB의 Image.filepath 컬럼에는 uploads_dir 기준 상대경로를 저장합니다.
예) "{dataset_id}/{hash_stem}.jpg"

실제 파일에 접근할 때는 resolve_filepath()를 통해 절대경로를 얻습니다.
하위 호환: 기존에 절대경로로 저장된 레코드는 그대로 사용됩니다.
"""
import os
import hashlib
import zipfile
import shutil
from pathlib import Path
from PIL import Image as PILImage
from app.core.config import get_settings

settings = get_settings()

SUPPORTED_FORMATS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tiff", ".tif", ".webp"}


# ── 경로 유틸리티 ─────────────────────────────────────────────────

def resolve_filepath(path: str) -> str:
    """
    DB에 저장된 경로를 절대경로로 변환.
    - 절대경로(/)로 시작하면 그대로 반환 (하위 호환)
    - 상대경로면 uploads_dir과 조합해 절대경로 반환
    """
    if os.path.isabs(path):
        return path
    return os.path.join(settings.uploads_dir, path)


def to_relative_path(abs_path: str) -> str:
    """
    절대경로를 uploads_dir 기준 상대경로로 변환.
    예) /app/data/uploads/3/abc_img.jpg → 3/abc_img.jpg
    """
    uploads_abs = os.path.abspath(settings.uploads_dir)
    abs_path_norm = os.path.abspath(abs_path)
    try:
        return os.path.relpath(abs_path_norm, uploads_abs)
    except ValueError:
        # Windows에서 드라이브가 다를 경우 절대경로 그대로 반환
        return abs_path


# ── 디렉터리 헬퍼 ──────────────────────────────────────────────────

def get_dataset_upload_dir(dataset_id: int) -> str:
    d = os.path.join(settings.uploads_dir, str(dataset_id))
    os.makedirs(d, exist_ok=True)
    return d


# ── 해시 ────────────────────────────────────────────────────────────

def calculate_md5(filepath: str) -> str:
    h = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def calculate_md5_bytes(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def calculate_phash(filepath: str) -> str:
    """절대경로를 받아 퍼셉추얼 해시 반환"""
    try:
        import imagehash
        img = PILImage.open(filepath).convert("RGB")
        return str(imagehash.phash(img))
    except Exception:
        return ""


# ── 이미지 메타 ─────────────────────────────────────────────────────

def get_image_dimensions(filepath: str) -> tuple:
    with PILImage.open(filepath) as img:
        return img.width, img.height


def get_file_format(filepath: str) -> str:
    return Path(filepath).suffix.lower().lstrip(".")


# ── 파일 저장 ────────────────────────────────────────────────────────

def save_uploaded_file(file_bytes: bytes, filename: str, dataset_id: int) -> str:
    """
    업로드된 파일을 저장하고 uploads_dir 기준 상대경로 반환.
    예) "3/a1b2c3d4_myimage.jpg"
    """
    dest_dir = get_dataset_upload_dir(dataset_id)
    name_hash = hashlib.md5(file_bytes).hexdigest()[:8]
    stem = Path(filename).stem
    suffix = Path(filename).suffix.lower()
    safe_name = f"{name_hash}_{stem}{suffix}"
    abs_path = os.path.join(dest_dir, safe_name)
    with open(abs_path, "wb") as f:
        f.write(file_bytes)
    return to_relative_path(abs_path)


def extract_zip_and_get_images(zip_bytes: bytes, dataset_id: int) -> list:
    """
    ZIP 파일에서 이미지를 추출하고 uploads_dir 기준 상대경로 목록 반환.
    """
    dest_dir = get_dataset_upload_dir(dataset_id)
    tmp_zip = os.path.join(dest_dir, "_tmp_upload.zip")
    with open(tmp_zip, "wb") as f:
        f.write(zip_bytes)

    rel_paths = []
    with zipfile.ZipFile(tmp_zip, "r") as zf:
        for member in zf.infolist():
            if member.is_dir():
                continue
            suffix = Path(member.filename).suffix.lower()
            if suffix not in SUPPORTED_FORMATS:
                continue
            safe_name = Path(member.filename).name
            abs_path = os.path.join(dest_dir, safe_name)
            with zf.open(member) as src, open(abs_path, "wb") as dst:
                shutil.copyfileobj(src, dst)
            rel_paths.append(to_relative_path(abs_path))

    os.remove(tmp_zip)
    return rel_paths


# ── 파일 삭제 ────────────────────────────────────────────────────────

def delete_file(path: str):
    """
    상대경로 또는 절대경로를 받아 파일 삭제.
    resolve_filepath()로 절대경로를 복원한 후 삭제 시도.
    """
    try:
        abs_path = resolve_filepath(path)
        if os.path.exists(abs_path):
            os.remove(abs_path)
    except Exception:
        pass


# ── 초기화 ────────────────────────────────────────────────────────────

def ensure_dirs():
    os.makedirs(settings.uploads_dir, exist_ok=True)
    os.makedirs(settings.exports_dir, exist_ok=True)
    os.makedirs(settings.embeddings_dir, exist_ok=True)
