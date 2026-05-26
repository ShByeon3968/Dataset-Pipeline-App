import numpy as np
from .base import BaseDetector, Detection


class RFDETRDetector(BaseDetector):
    """RF-DETR ONNX 출력: pred_logits [1,N,nc] + pred_boxes [1,N,4] cxcywh normalized"""

    def preprocess(self, bgr: np.ndarray, input_w: int, input_h: int) -> np.ndarray:
        import cv2
        img = cv2.resize(bgr, (input_w, input_h))
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        return img.transpose(2, 0, 1)[np.newaxis]

    def postprocess(self, outputs, orig_w, orig_h, input_w, input_h, conf_threshold, iou_threshold):
        # outputs[0] = pred_logits [1, N, nc]
        # outputs[1] = pred_boxes  [1, N, 4]  cxcywh normalized
        logits = outputs[0][0]      # [N, nc]
        boxes  = outputs[1][0]      # [N, 4]

        scores = 1.0 / (1.0 + np.exp(-logits))   # sigmoid
        class_ids   = scores.argmax(axis=1)
        confidences = scores[np.arange(len(class_ids)), class_ids]

        mask = confidences >= conf_threshold
        boxes, class_ids, confidences = boxes[mask], class_ids[mask], confidences[mask]

        cx, cy, bw, bh = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        return [
            Detection(
                x=float(cx[i] - bw[i] / 2), y=float(cy[i] - bh[i] / 2),
                w=float(bw[i]), h=float(bh[i]),
                class_id=int(class_ids[i]), confidence=float(confidences[i]),
            )
            for i in range(len(class_ids))
        ]
