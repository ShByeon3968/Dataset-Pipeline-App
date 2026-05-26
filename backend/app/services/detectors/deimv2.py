import numpy as np
from .base import BaseDetector, Detection


class DEIMv2Detector(BaseDetector):
    """
    DEIMv2 ONNX 출력 형식:
      outputs[0] = 'dets'   [1, 300, 4]  xyxy
      outputs[1] = 'labels' [1, 300, nc] 클래스별 점수 행렬

    orig_target_sizes 를 모델에 전달한 경우 박스 좌표는 원본 이미지(orig_w x orig_h)
    픽셀 기준으로 출력됨. 전달하지 않은 경우 입력 해상도(input_w x input_h) 또는
    0~1 정규화 좌표로 출력될 수 있음.
    x2 > 2.0 로 픽셀/정규화 여부를 판별하고, 픽셀인 경우 orig_w/orig_h 로 정규화.
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

            # 픽셀 좌표 여부 판별 후 orig 기준으로 정규화
            # orig_target_sizes 전달 시 → 원본 픽셀(orig_w x orig_h) 기준
            # 전달 안 한 경우    → 입력 픽셀(input_w x input_h) 기준 가능성 있음
            if x2 > 2.0:
                scale_x = orig_w if x2 <= orig_w * 1.1 else input_w
                scale_y = orig_h if y2 <= orig_h * 1.1 else input_h
                x1, x2 = x1 / scale_x, x2 / scale_x
                y1, y2 = y1 / scale_y, y2 / scale_y

            results.append(Detection(
                x=float(x1), y=float(y1),
                w=float(x2 - x1), h=float(y2 - y1),
                class_id=int(class_ids[i]),
                confidence=float(confidences[i]),
            ))
        return results
