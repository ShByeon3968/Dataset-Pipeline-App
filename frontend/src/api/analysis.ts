import client from './client'
import type { ClassDistribution, BboxStats, DatasetSummary } from '../types'

// ── 임베딩 산점도 ──────────────────────────────────────────────────────
export interface EmbeddingPoint {
  image_id: number
  filename: string
  x: number
  y: number
  thumbnail_url: string   // /api/v1/datasets/{id}/images/{id}/file
  class_names: string[]
  class_colors: string[]
  label: string           // 첫 번째 클래스명 또는 "unlabeled"
}

export interface EmbeddingResult {
  points: EmbeddingPoint[]
  total: number
  method: string          // "pca" | "umap" | "tsne"
  embedding_model: string // "clip" | "histogram" | "none"
  note?: string
}

// ── 이상치 / 중복 탐지 ────────────────────────────────────────────────
export interface OutlierItem {
  image_id: number
  filename: string
  thumbnail_url: string
  nn_distance: number
  class_names: string[]
}

export interface DuplicateCandidate {
  image_a: { image_id: number; filename: string; thumbnail_url: string }
  image_b: { image_id: number; filename: string; thumbnail_url: string }
  distance: number
}

export interface OutlierResult {
  outliers: OutlierItem[]
  duplicate_candidates: DuplicateCandidate[]
  total_images: number
  note?: string
}

// ── Split 통계 ────────────────────────────────────────────────────────
export interface SplitStats {
  train: number
  val: number
  test: number
  unsplit: number
  total: number
}

// ── 임베딩 사전 계산 상태 ─────────────────────────────────────────────
export interface ComputeStatus {
  dataset_id: number
  status: 'not_started' | 'running' | 'done' | 'error' | 'already_running'
  result?: { computed: number; cached: number; failed: number }
  error?: string
}

// ── API ───────────────────────────────────────────────────────────────
export const analysisApi = {
  summary: (datasetId: number) =>
    client.get<DatasetSummary>(`/datasets/${datasetId}/analysis/summary`).then(r => r.data),

  classDistribution: (datasetId: number) =>
    client.get<ClassDistribution[]>(`/datasets/${datasetId}/analysis/class-distribution`).then(r => r.data),

  bboxStats: (datasetId: number) =>
    client.get<BboxStats>(`/datasets/${datasetId}/analysis/bbox-stats`).then(r => r.data),

  splitStats: (datasetId: number) =>
    client.get<SplitStats>(`/datasets/${datasetId}/analysis/split-stats`).then(r => r.data),

  embeddings: (datasetId: number, method: 'pca' | 'umap' | 'tsne' = 'pca') =>
    client.get<EmbeddingResult>(
      `/datasets/${datasetId}/analysis/embeddings?method=${method}`
    ).then(r => r.data),

  outliers: (datasetId: number, topK = 20, duplicateThreshold = 0.05) =>
    client.get<OutlierResult>(
      `/datasets/${datasetId}/analysis/embeddings/outliers?top_k=${topK}&duplicate_threshold=${duplicateThreshold}`
    ).then(r => r.data),

  computeEmbeddings: (datasetId: number) =>
    client.post<ComputeStatus>(
      `/datasets/${datasetId}/analysis/embeddings/compute`
    ).then(r => r.data),

  computeStatus: (datasetId: number) =>
    client.get<ComputeStatus>(
      `/datasets/${datasetId}/analysis/embeddings/compute/status`
    ).then(r => r.data),

  analyzeCoco: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return client.post('/analysis/coco-json', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
}
