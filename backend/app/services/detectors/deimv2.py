import numpy as np
from .base import BaseDetector, Detection


class DEIMv2Detector(BaseDetector):
    """
    DEIMv2 ONNX 실제 출력 형식:
      outputs[0] = 'dets'   [1, 300, 4]  xyxy (normalized 또는 픽셀)
      outputs[1] = 'labels' [1, 300, nc] 클래스별 점수 행렬
    """

    def preprocess(self, bgr: np.ndarray, input_w: int, input_h: int) -> np.ndarray:
        import cv2
        img = cv2.resize(bgr, (input_w, input_h))
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        return img.transpose(2, 0, 1)[np.newaxis]

    def postprocess(self, outputs, orig_w, orig_h, input_w, input_h, conf_threshold, iou_threshold):
        boxes        = outputs[0][0]   # [300, 4]  xyxy
        class_scores = outputs[1][0]   # [300, nc]

        class_ids   = class_scores.argmax(axis=1)
        confidences = class_scores[np.arange(len(class_ids)), class_ids]

        mask = confidences >= conf_threshold
        boxes, class_ids, confidences = boxes[mask], class_ids[mask], confidences[mask]

        results = []
        for i in range(len(class_ids)):
            x1, y1, x2, y2 = boxes[i]

            # 좌표가 픽셀 단위인 경우 정규화
            if x2 > 2.0:
                x1, x2 = x1 / input_w, x2 / input_w
                y1, y2 = y1 / input_h, y2 / input_h

            results.append(Detection(
                x=float(x1), y=float(y1),
                w=float(x2 - x1), h=float(y2 - y1),
                class_id=int(class_ids[i]),
                confidence=float(confidences[i]),
            ))
        return results
