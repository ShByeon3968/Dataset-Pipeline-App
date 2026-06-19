import client from './client'

export interface AutoLabelRequest {
  mode?: 'yolo_world' | 'onnx' | 'locate_anything'
  text_prompts?: string[]
  onnx_model_id?: number | null
  confidence_threshold?: number
  iou_threshold?: number
  overwrite?: boolean
  skip_labeled?: boolean
  upload_batch_id?: string | null
}

export interface AutoLabelRun {
  id: number
  dataset_id: number
  model_name: string
  confidence_threshold: number
  iou_threshold: number
  text_prompts?: string | null
  onnx_model_id?: number | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  total_images: number
  processed_images: number
  total_annotations: number
  error_message?: string | null
}

export interface AutoLabelRunList {
  items: AutoLabelRun[]
  total: number
}

export const autoLabelApi = {
  startRun: (datasetId: number, req: AutoLabelRequest) =>
    client.post<AutoLabelRun>(`/auto-label/datasets/${datasetId}/runs`, req),

  listRuns: (datasetId: number) =>
    client.get<AutoLabelRunList>(`/auto-label/datasets/${datasetId}/runs`),

  getRun: (datasetId: number, runId: number) =>
    client.get<AutoLabelRun>(`/auto-label/datasets/${datasetId}/runs/${runId}`),

  deleteAnnotations: (datasetId: number, runId: number) =>
    client.delete(`/auto-label/datasets/${datasetId}/runs/${runId}/annotations`),

  cancelRun: (datasetId: number, runId: number) =>
    client.post<AutoLabelRun>(`/auto-label/datasets/${datasetId}/runs/${runId}/cancel`),
}
