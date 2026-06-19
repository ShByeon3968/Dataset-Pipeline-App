import os
import re
import logging
import torch
from PIL import Image as PILImage
from eagle.Embodied.locateanything_worker import LocateAnythingWorker


logger = logging.getLogger(__name__)
_model = None
MODEL_ID = "nvidia/LocateAnything-3B"

def get_model():
    global _model
    if _model is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        cache_dir = os.environ.get("HF_HOME", "./data/models")
        _model = LocateAnythingWorker(MODEL_ID, cache_dir=cache_dir, device=device)
    return _model

def parse_coco_xml_boxes(answer: str, img_w: int, img_h: int) -> list[dict]:
    """
    Parse VLM bounding box output <ref>label</ref><box><x1><y1><x2><y2></box>
    Convert [0, 1000] integer coordinates to 0~1 relative coordinates.
    """
    detections = []
    pattern = r"<ref>(.*?)</ref>\s*<box><(\d+)><(\d+)><(\d+)><(\d+)></box>"
    for m in re.finditer(pattern, answer):
        label = m.group(1)
        x1 = int(m.group(2)) / 1000.0
        y1 = int(m.group(3)) / 1000.0
        x2 = int(m.group(4)) / 1000.0
        y2 = int(m.group(5)) / 1000.0
        
        bw = x2 - x1
        bh = y2 - y1
        if bw <= 0 or bh <= 0:
            continue
            
        detections.append({
            "class_name": label,
            "bbox": {
                "x": x1,
                "y": y1,
                "w": bw,
                "h": bh
            },
            "confidence": 1.0,
            "segmentation": None
        })
    return detections

def predict_image_la(image_path: str, text_prompts: list[str]) -> list[dict]:
    if not text_prompts:
        raise ValueError("text_prompts must not be empty")
        
    model = get_model()
    
    img = PILImage.open(image_path).convert("RGB")
    img_w, img_h = img.size
    
    output_text = model.detect(img, text_prompts)["answer"]
    
    logger.debug("LocateAnything raw output: %s", output_text)
    return parse_coco_xml_boxes(output_text, img_w, img_h)

def predict_images_la_batch(image_paths: list[str], text_prompts: list[str]) -> list[list[dict]]:
    if not text_prompts:
        raise ValueError("text_prompts must not be empty")
        
    if not image_paths:
        return []
        
    model = get_model()
    
    pil_images = []
    image_dims = []
    valid_indices = []
    
    for idx, path in enumerate(image_paths):
        try:
            img = PILImage.open(path).convert("RGB")
            pil_images.append(img)
            image_dims.append(img.size)
            valid_indices.append(idx)
        except Exception as e:
            logger.error("Failed to load image %s: %s", path, e)
            
    if not pil_images:
        return [[] for _ in image_paths]
        
    requests = [(img, text_prompts) for img in pil_images]
    batch_results = model.detect_batch(requests)
    
    results = [[] for _ in image_paths]
    for list_idx, val_idx in enumerate(valid_indices):
        output_text = batch_results[list_idx]["answer"]
        w, h = image_dims[list_idx]
        results[val_idx] = parse_coco_xml_boxes(output_text, w, h)
        
    return results