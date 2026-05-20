import client from './client'
import type { ClassDistribution, BboxStats, DatasetSummary } from '../types'

export interface EmbeddingPoint {
  x: number
  y: number
  annotation_id: number
  class_name: string
  class_color: string
}

export interface EmbeddingResult {
  points: EmbeddingPoint[]
  total: number
  note?: string
}

export const analysisApi = {
  summary: (datasetId: number) =>
    client.get<DatasetSummary>(`/datasets/${datasetId}/analysis/summary`).then(r => r.data),

  classDistribution: (datasetId: number) =>
    client.get<ClassDistribution[]>(`/datasets/${datasetId}/analysis/class-distribution`).then(r => r.data),

  bboxStats: (datasetId: number) =>
    client.get<BboxStats>(`/datasets/${datasetId}/analysis/bbox-stats`).then(r => r.data),

  embeddings: (datasetId: number) =>
    client.get<EmbeddingResult>(`/datasets/${datasetId}/analysis/embeddings`).then(r => r.data),

  analyzeCoco: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return client.post('/analysis/coco-json', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
}
