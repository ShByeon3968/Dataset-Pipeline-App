import os
import cv2
import tempfile
import logging
from pathlib import Path

from app.services.file_handler import save_image_to_storage

logger = logging.getLogger(__name__)

def extract_frames_from_video(video_bytes: bytes, filename: str, dataset_id: int, frame_step: int = 30) -> list[str]:
    """
    비디오에서 프레임을 추출하여 저장소에 이미지로 저장합니다.
    
    :param video_bytes: 비디오 파일 바이트
    :param filename: 원본 비디오 파일명
    :param dataset_id: 저장할 대상 데이터셋 ID
    :param frame_step: 추출 간격 프레임 수 (예: 30이면 30프레임마다 1장 추출)
    :return: 저장된 이미지들의 storage_key 리스트
    """
    keys = []
    base_filename = Path(filename).stem
    
    # 임시 파일로 비디오 저장
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp_file:
        tmp_file.write(video_bytes)
        tmp_path = tmp_file.name

    try:
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            logger.error(f"Failed to open video file {filename}")
            return keys

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            logger.warning(f"Video {filename} has no frames or could not read frame count.")
            return keys

        frame_idx = 0
        extracted_count = 0
        while True:
            # frame_step에 따라 특정 프레임으로 바로 점프
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                break
                
            # OpenCV 이미지를 JPEG 바이트로 인코딩
            success, encoded_image = cv2.imencode('.jpg', frame)
            if success:
                # 프레임의 고유 파일명 생성
                frame_filename = f"{base_filename}_frame_{frame_idx:06d}.jpg"
                _, key = save_image_to_storage(encoded_image.tobytes(), frame_filename, dataset_id)
                keys.append(key)
                extracted_count += 1
            
            frame_idx += frame_step
            if frame_idx >= total_frames:
                break
                
    except Exception as e:
        logger.error(f"Error during video extraction for {filename}: {e}")
    finally:
        cap.release()
        try:
            os.remove(tmp_path)
        except Exception:
            pass

    return keys
