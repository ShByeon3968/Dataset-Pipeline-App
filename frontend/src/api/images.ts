import client from './client'
import type { Image } from '../types'

export const imagesApi = {
  list: (datasetId: number, skip = 0, limit = 100) =>
    client.get<{ items: Image[]; total: number }>(
      `/datasets/${datasetId}/images?skip=${skip}&limit=${limit}`
    ).then(r => r.data),

  get: (datasetId: number, imageId: number) =>
    client.get<Image>(`/datasets/${datasetId}/images/${imageId}`).then(r => r.data),

  getFileUrl: (datasetId: number, imageId: number) =>
    `/api/v1/datasets/${datasetId}/images/${imageId}/file`,

  uploadFiles: (datasetId: number, files: File[], onProgress?: (pct: number) => void) => {
    const formData = new FormData()
    files.forEach(f => formData.append('files', f))
    return client.post<{ added: number; skipped: number; errors: unknown[] }>(
      `/datasets/${datasetId}/images/upload`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total))
        },
      }
    ).then(r => r.data)
  },

  uploadZip: (datasetId: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return client.post<{ added: number }>(
      `/datasets/${datasetId}/images/upload-zip`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    ).then(r => r.data)
  },

  uploadZipAnnotated: (
    datasetId: number,
    file: File,
    format?: 'coco' | 'yolo',
    onProgress?: (pct: number) => void,
  ) => {
    const formData = new FormData()
    formData.append('file', file)
    const params = format ? `?fmt=${format}` : ''
    return client.post<{ format: string; added: number; skipped: number; errors: number }>(
      `/datasets/${datasetId}/images/upload-zip-annotated${params}`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total))
        },
      }
    ).then(r => r.data)
  },

  importRoboflow: (
    datasetId: number,
    apiKey: string,
    workspace: string,
    projectId: string,
    version: number,
  ) =>
    client.post<{ format: string; added: number; skipped: number; errors: number }>(
      `/datasets/${datasetId}/images/import-roboflow`,
      { api_key: apiKey, workspace, project_id: projectId, version }
    ).then(r => r.data),

  delete: (datasetId: number, imageId: number) =>
    client.delete(`/datasets/${datasetId}/images/${imageId}`),
}
