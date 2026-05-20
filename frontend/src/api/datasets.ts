import client from './client'
import type { Dataset, DatasetCreate } from '../types'

export const datasetsApi = {
  list: () => client.get<{ items: Dataset[]; total: number }>('/datasets').then(r => r.data),
  get: (id: number) => client.get<Dataset>(`/datasets/${id}`).then(r => r.data),
  create: (data: DatasetCreate) => client.post<Dataset>('/datasets', data).then(r => r.data),
  update: (id: number, data: Partial<DatasetCreate>) =>
    client.patch<Dataset>(`/datasets/${id}`, data).then(r => r.data),
  delete: (id: number) => client.delete(`/datasets/${id}`),
}
