import type { SplitRatios } from '../store'

export const exportApi = {
  download: (
    datasetId: number,
    format: 'coco' | 'yolo' | 'voc',
    splitRatios?: SplitRatios,
  ) => {
    let url = `/api/v1/datasets/${datasetId}/export/${format}`
    if (splitRatios) {
      const total = splitRatios.train + splitRatios.val + splitRatios.test
      if (total > 0) {
        const tr = (splitRatios.train / total).toFixed(4)
        const vr = (splitRatios.val / total).toFixed(4)
        const testr = (splitRatios.test / total).toFixed(4)
        url += `?train_ratio=${tr}&val_ratio=${vr}&test_ratio=${testr}`
      }
    }
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
