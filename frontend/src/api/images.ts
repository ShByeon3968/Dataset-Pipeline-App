import client from './client'
import type { Image } from '../types'

export const imagesApi = {
  list: (datasetId: number, skip = 0, limit = 100) =>
    client.get<{ items: Image[]; total: number }>(
      `/datasets/${datasetId}/images?skip=${skip}&limit=${limit}`
    ).then(r => r.data),

  getBatches: (datasetId: number) =>
    client.get<{ items: { batch_id: string | null; count: number }[]; total: number }>(
      `/datasets/${datasetId}/images/batches`
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

  // 202 Accepted -> task_id 반환, pollImportTask 으로 완료 대기
  uploadZipAnnotated: (
    datasetId: number,
    file: File,
    format?: 'coco' | 'yolo',
    onProgress?: (pct: number) => void,
  ) => {
    const formData = new FormData()
    formData.append('file', file)
    const params = format ? `?fmt=${format}` : ''
    return client.post<{ task_id: string; status: string }>(
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

  uploadVideo: (
    datasetId: number,
    file: File,
    frameStep: number,
    onProgress?: (pct: number) => void,
  ) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('frame_step', frameStep.toString())
    return client.post<{ added: number; extracted: number }>(
      `/datasets/${datasetId}/images/upload-video`,
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
    client.post<{ task_id: string; status: string }>(
      `/datasets/${datasetId}/images/import-roboflow`,
      { api_key: apiKey, workspace, project_id: projectId, version }
    ).then(r => r.data),

  // 태스크 완료까지 폴링 (최대 5분, 2초 간격)
  pollImportTask: (
    datasetId: number,
    taskId: string,
    onStatus?: (s: string) => void,
  ): Promise<{ format?: string; added: number; skipped: number; errors: number }> => {
    return new Promise((resolve, reject) => {
      const MAX_ATTEMPTS = 150  // 150 x 2s = 5분
      let attempts = 0
      const timer = setInterval(async () => {
        attempts++
        try {
          const res = await client.get<{
            status: string
            result: { format?: string; added: number; skipped: number; errors: number } | null
            error: string | null
          }>(`/datasets/${datasetId}/images/tasks/${taskId}`)
          const { status, result, error } = res.data
          onStatus?.(status)
          if (status === 'done') {
            clearInterval(timer)
            resolve(result ?? { added: 0, skipped: 0, errors: 0 })
          } else if (status === 'error') {
            clearInterval(timer)
            reject(new Error(error ?? '임포트 실패'))
          } else if (attempts >= MAX_ATTEMPTS) {
            clearInterval(timer)
            reject(new Error('임포트 시간 초과'))
          }
        } catch (e) {
          clearInterval(timer)
          reject(e)
        }
      }, 2000)
    })
  },

  delete: (datasetId: number, imageId: number) =>
    client.delete(`/datasets/${datasetId}/images/${imageId}`),
}
