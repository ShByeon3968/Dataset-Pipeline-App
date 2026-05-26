import numpy as np
from .base import BaseDetector, Detection, nms


class YOLOv5Detector(BaseDetector):
    """YOLOv5 / YOLOv7 ONNX 출력: [1, na, 5+nc] (cx,cy,w,h,obj_conf,class_scores)"""

    def preprocess(self, bgr: np.ndarray, input_w: int, input_h: int) -> np.ndarray:
        import cv2
        img = self._letterbox(bgr, input_w, input_h)
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        return img.transpose(2, 0, 1)[np.newaxis]

    def postprocess(self, outputs, orig_w, orig_h, input_w, input_h, conf_threshold, iou_threshold):
        pred = outputs[0][0]        # [na, 5+nc]
        obj_conf = pred[:, 4]
        class_scores = pred[:, 5:] * obj_conf[:, None]
        class_ids = class_scores.argmax(axis=1)
        confidences = class_scores[np.arange(len(class_ids)), class_ids]

        mask = confidences >= conf_threshold
        pred, class_ids, confidences = pred[mask], class_ids[mask], confidences[mask]

        cx = pred[:, 0] / input_w
        cy = pred[:, 1] / input_h
        bw = pred[:, 2] / input_w
        bh = pred[:, 3] / input_h
        x1, y1 = cx - bw / 2, cy - bh / 2
        x2, y2 = cx + bw / 2, cy + bh / 2
        boxes = np.stack([x1, y1, x2, y2], axis=1)
        keep = nms(boxes, confidences, iou_threshold)

        return [
            Detection(
                x=float(x1[i]), y=float(y1[i]),
                w=float(bw[i]), h=float(bh[i]),
                class_id=int(class_ids[i]), confidence=float(confidences[i]),
            )
            for i in keep
        ]
