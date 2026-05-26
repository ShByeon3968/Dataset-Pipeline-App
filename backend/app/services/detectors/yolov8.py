import numpy as np
from .base import BaseDetector, Detection, nms


class YOLOv8Detector(BaseDetector):
    """YOLOv8 / YOLOv11 ONNX 출력: [1, 4+nc, na] (cx,cy,w,h + class scores)"""

    def preprocess(self, bgr: np.ndarray, input_w: int, input_h: int) -> np.ndarray:
        import cv2
        img = self._letterbox(bgr, input_w, input_h)
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        return img.transpose(2, 0, 1)[np.newaxis]

    def postprocess(self, outputs, orig_w, orig_h, input_w, input_h, conf_threshold, iou_threshold):
        pred = outputs[0]
        if pred.ndim == 3:
            pred = pred[0]          # [4+nc, na]
        pred = pred.T               # [na, 4+nc]

        cx, cy, bw, bh = pred[:, 0], pred[:, 1], pred[:, 2], pred[:, 3]
        class_scores = pred[:, 4:]
        class_ids = class_scores.argmax(axis=1)
        confidences = class_scores[np.arange(len(class_ids)), class_ids]

        mask = confidences >= conf_threshold
        cx, cy, bw, bh = cx[mask], cy[mask], bw[mask], bh[mask]
        class_ids, confidences = class_ids[mask], confidences[mask]

        # 픽셀 좌표 → normalized
        x1 = (cx - bw / 2) / input_w
        y1 = (cy - bh / 2) / input_h
        x2 = (cx + bw / 2) / input_w
        y2 = (cy + bh / 2) / input_h
        boxes = np.stack([x1, y1, x2, y2], axis=1)
        keep = nms(boxes, confidences, iou_threshold)

        return [
            Detection(
                x=float(x1[i]), y=float(y1[i]),
                w=float(x2[i] - x1[i]), h=float(y2[i] - y1[i]),
                class_id=int(class_ids[i]), confidence=float(confidences[i]),
            )
            for i in keep
        ]
