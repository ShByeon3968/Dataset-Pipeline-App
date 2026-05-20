import client from './client'
import type { Class } from '../types'

export const classesApi = {
  list: (datasetId: number) =>
    client.get<Class[]>(`/datasets/${datasetId}/classes`).then(r => r.data),

  create: (datasetId: number, name: string, color?: string) =>
    client.post<Class>(`/datasets/${datasetId}/classes`, { dataset_id: datasetId, name, color }).then(r => r.data),

  update: (datasetId: number, classId: number, data: { name?: string; color?: string }) =>
    client.patch<Class>(`/datasets/${datasetId}/classes/${classId}`, data).then(r => r.data),

  delete: (datasetId: number, classId: number) =>
    client.delete(`/datasets/${datasetId}/classes/${classId}`),
}
