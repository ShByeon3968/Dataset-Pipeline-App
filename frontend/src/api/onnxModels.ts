import client from './client'

export interface OnnxModel {
  id: number
  name: string
  architecture: 'yolov8' | 'yolov5' | 'rfdetr' | 'deimv2'
  file_size: number | null
  class_labels: string[]
  input_width: number
  input_height: number
  conf_threshold: number
  iou_threshold: number
  created_at: string
  updated_at: string
}

export interface OnnxModelValidation {
  inputs: Array<{ name: string; shape: number[]; dtype: string }>
  outputs: Array<{ name: string; shape: number[]; dtype: string }>
}

export const onnxModelsApi = {
  list: (): Promise<OnnxModel[]> =>
    client.get<OnnxModel[]>('/onnx-models').then(r => r.data),

  get: (modelId: number): Promise<OnnxModel> =>
    client.get<OnnxModel>(`/onnx-models/${modelId}`).then(r => r.data),

  upload: (
    file: File,
    meta: {
      name: string
      architecture: string
      class_labels: string[]
      input_width?: number
      input_height?: number
      conf_threshold?: number
      iou_threshold?: number
    },
    onProgress?: (pct: number) => void,
  ): Promise<OnnxModel> => {
    const form = new FormData()
    form.append('file', file)
    form.append('name', meta.name)
    form.append('architecture', meta.architecture)
    form.append('class_labels', JSON.stringify(meta.class_labels))
    if (meta.input_width != null) form.append('input_width', String(meta.input_width))
    if (meta.input_height != null) form.append('input_height', String(meta.input_height))
    if (meta.conf_threshold != null) form.append('conf_threshold', String(meta.conf_threshold))
    if (meta.iou_threshold != null) form.append('iou_threshold', String(meta.iou_threshold))

    return client
      .post<OnnxModel>('/onnx-models/upload', form, {
        timeout: 300_000,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => {
          if (onProgress && e.total) {
            onProgress(Math.round((e.loaded / e.total) * 100))
          }
        },
      })
      .then(r => r.data)
  },

  validate: (modelId: number): Promise<OnnxModelValidation> =>
    client.get<OnnxModelValidation>(`/onnx-models/${modelId}/validate`).then(r => r.data),

  delete: (modelId: number): Promise<void> =>
    client.delete(`/onnx-models/${modelId}`).then(() => undefined),
}
