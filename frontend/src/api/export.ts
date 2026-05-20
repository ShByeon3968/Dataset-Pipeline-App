export const exportApi = {
  download: (datasetId: number, format: 'coco' | 'yolo' | 'voc') => {
    // 직접 링크로 다운로드
    const url = `/api/v1/datasets/${datasetId}/export/${format}`
    const a = document.createElement('a')
    a.href = url
    a.download = `dataset_${datasetId}_${format}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  },

  getUrl: (datasetId: number, format: string) =>
    `/api/v1/datasets/${datasetId}/export/${format}`,
}
