import client from './client'
import type { Annotation, AnnotationCreate } from '../types'

export const annotationsApi = {
  list: (datasetId: number, imageId: number) =>
    client
      .get<Annotation[]>(`/datasets/${datasetId}/images/${imageId}/annotations`)
      .then(r => r.data),

  create: (datasetId: number, imageId: number, data: AnnotationCreate) =>
    client
      .post<Annotation>(`/datasets/${datasetId}/images/${imageId}/annotations`, data)
      .then(r => r.data),

  update: (
    datasetId: number,
    imageId: number,
    annotationId: number,
    data: Partial<AnnotationCreate>,
  ) =>
    client
      .put<Annotation>(
        `/datasets/${datasetId}/images/${imageId}/annotations/${annotationId}`,
        data,
      )
      .then(r => r.data),

  delete: (datasetId: number, imageId: number, annotationId: number) =>
    client
      .delete(`/datasets/${datasetId}/images/${imageId}/annotations/${annotationId}`)
      .then(r => r.data),
}
