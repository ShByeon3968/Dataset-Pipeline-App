import client from './client'
import type {
  DatasetVersion,
  DatasetVersionCreate,
  ModelVersion,
  ModelVersionCreate,
  ModelDatasetLink,
  LineageGraph,
} from '../types'

interface PaginatedVersions {
  items: DatasetVersion[]
  total: number
}

interface PaginatedModels {
  items: ModelVersion[]
  total: number
}

export const versionsApi = {
  // ── 데이터셋 버전 ────────────────────────────────────────────
  list: (datasetId: number, branch?: string, skip = 0, limit = 50) => {
    const params: Record<string, unknown> = { skip, limit }
    if (branch) params.branch = branch
    return client
      .get<PaginatedVersions>(`/datasets/${datasetId}/versions`, { params })
      .then(r => r.data)
  },

  get: (datasetId: number, versionId: number) =>
    client
      .get<DatasetVersion>(`/datasets/${datasetId}/versions/${versionId}`)
      .then(r => r.data),

  create: (datasetId: number, payload: DatasetVersionCreate) =>
    client
      .post<DatasetVersion>(`/datasets/${datasetId}/versions`, payload)
      .then(r => r.data),

  delete: (datasetId: number, versionId: number) =>
    client.delete(`/datasets/${datasetId}/versions/${versionId}`),

  // ── 모델 버전 ────────────────────────────────────────────────
  listModels: (skip = 0, limit = 50) =>
    client
      .get<PaginatedModels>('/model-versions', { params: { skip, limit } })
      .then(r => r.data),

  createModel: (payload: ModelVersionCreate) =>
    client.post<ModelVersion>('/model-versions', payload).then(r => r.data),

  deleteModel: (modelVersionId: number) =>
    client.delete(`/model-versions/${modelVersionId}`),

  // ── 모델↔데이터셋 버전 링크 ─────────────────────────────────
  linkModel: (
    modelVersionId: number,
    datasetVersionId: number,
    datasetId: number,
    note = '',
    linked_by = 'user',
  ) =>
    client
      .post<ModelDatasetLink>(`/model-versions/${modelVersionId}/links`, {
        dataset_version_id: datasetVersionId,
        dataset_id: datasetId,
        linked_by,
        note,
      })
      .then(r => r.data),

  listLinks: (modelVersionId: number) =>
    client
      .get<ModelDatasetLink[]>(`/model-versions/${modelVersionId}/links`)
      .then(r => r.data),

  unlinkModel: (linkId: number) =>
    client.delete(`/model-versions/links/${linkId}`),

  // ── 리니지 그래프 ────────────────────────────────────────────
  getLineage: (datasetId: number) =>
    client.get<LineageGraph>(`/datasets/${datasetId}/lineage`).then(r => r.data),
}
