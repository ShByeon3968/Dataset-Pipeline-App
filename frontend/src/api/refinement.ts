import client from './client'

export const refinementApi = {
  duplicates: (datasetId: number) =>
    client.get(`/datasets/${datasetId}/refinement/duplicates`).then(r => r.data),

  filterBbox: (datasetId: number, minArea: number, maxArea: number, dryRun = true) =>
    client.post(`/datasets/${datasetId}/refinement/filter-bbox`, {
      min_area: minArea,
      max_area: maxArea,
      dry_run: dryRun,
    }).then(r => r.data),

  deleteImages: (datasetId: number, imageIds: number[]) =>
    client.post(`/datasets/${datasetId}/refinement/delete-images`, {
      image_ids: imageIds,
    }).then(r => r.data),

  /** 중복 그룹 검수: 대표 이미지를 유지하고 나머지를 삭제합니다. */
  resolveDuplicate: (
    datasetId: number,
    keepImageId: number | null,
    deleteImageIds: number[],
  ) =>
    client.post<{ deleted: number; kept_image_id: number | null }>(
      `/datasets/${datasetId}/refinement/resolve-duplicate`,
      { keep_image_id: keepImageId, delete_image_ids: deleteImageIds },
    ).then(r => r.data),

  labelErrors: (datasetId: number) =>
    client.get(`/datasets/${datasetId}/refinement/label-errors`).then(r => r.data),
}
