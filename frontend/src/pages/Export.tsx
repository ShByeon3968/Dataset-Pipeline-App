import { useState } from 'react'
import toast from 'react-hot-toast'
import { Download, FileJson, AlignLeft, Code2 } from 'lucide-react'
import { exportApi } from '../api/export'
import { useAppStore } from '../store'

const formats = [
  {
    id: 'coco' as const,
    label: 'COCO JSON',
    icon: FileJson,
    desc: 'COCO 2017 standard format. images, annotations, categories structure.',
    color: 'bg-blue-50 border-blue-200 text-blue-700',
  },
  {
    id: 'yolo' as const,
    label: 'YOLO',
    icon: AlignLeft,
    desc: 'Per-image .txt labels, normalized coords (cx cy w h). Includes classes.txt and data.yaml.',
    color: 'bg-green-50 border-green-200 text-green-700',
  },
  {
    id: 'voc' as const,
    label: 'Pascal VOC',
    icon: Code2,
    desc: 'Per-image XML files (xmin ymin xmax ymax absolute coords).',
    color: 'bg-purple-50 border-purple-200 text-purple-700',
  },
]

export default function ExportPage() {
  const { selectedDataset, splitRatios } = useAppStore()
  const [loading, setLoading] = useState<string | null>(null)

  const handleExport = async (format: 'coco' | 'yolo' | 'voc') => {
    if (!selectedDataset) return toast.error('Select a dataset first.')
    setLoading(format)
    try {
      exportApi.download(selectedDataset.id, format, splitRatios)
      toast.success(`${format.toUpperCase()} export started`)
    } catch {
      toast.error('Export failed')
    } finally {
      setTimeout(() => setLoading(null), 2000)
    }
  }

  if (!selectedDataset) {
    return <div className="card p-8 text-center text-gray-500">Select a dataset from the home screen.</div>
  }

  const totalRatio = splitRatios.train + splitRatios.val + splitRatios.test

  return (
    <div>
      <h1 className="page-header">Export Dataset</h1>
      <p className="page-subtitle">Download as COCO JSON, YOLO, or Pascal VOC format.</p>

      <div className="card p-5 mb-4">
        <h2 className="font-semibold mb-1">{selectedDataset.name}</h2>
        <p className="text-sm text-gray-500">
          {selectedDataset.image_count} images · {selectedDataset.annotation_count} annotations · {selectedDataset.class_count} classes
        </p>
      </div>

      {/* Split ratio summary */}
      <div className="card p-4 mb-6 bg-gray-50 border border-gray-200">
        <p className="text-xs text-gray-500 mb-2 font-medium">
          Split ratios for unsplit images (set in Analysis tab)
        </p>
        <div className="flex h-4 rounded overflow-hidden w-full mb-2">
          {totalRatio > 0 && (
            <>
              <div style={{ width: `${(splitRatios.train / totalRatio) * 100}%`, background: '#3B82F6' }} />
              <div style={{ width: `${(splitRatios.val   / totalRatio) * 100}%`, background: '#F59E0B' }} />
              <div style={{ width: `${(splitRatios.test  / totalRatio) * 100}%`, background: '#10B981' }} />
            </>
          )}
        </div>
        <div className="flex gap-4 text-xs">
          <span className="text-blue-600 font-medium">Train {splitRatios.train}%</span>
          <span className="text-amber-500 font-medium">Val {splitRatios.val}%</span>
          <span className="text-emerald-500 font-medium">Test {splitRatios.test}%</span>
          <span className="text-gray-400 ml-auto">Adjust in Analysis → Split Balance</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {formats.map(({ id, label, icon: Icon, desc, color }) => (
          <div key={id} className={`card p-6 border-2 ${color}`}>
            <div className="flex items-center gap-3 mb-3">
              <Icon className="w-6 h-6" />
              <span className="font-bold text-lg">{label}</span>
            </div>
            <p className="text-sm mb-6 opacity-80">{desc}</p>
            <button
              onClick={() => handleExport(id)}
              disabled={loading === id}
              className="w-full flex items-center justify-center gap-2 bg-white border-2 border-current rounded-lg py-2.5 text-sm font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {loading === id ? 'Generating...' : `Download ${label}`}
            </button>
          </div>
        ))}
      </div>

      <div className="card p-5 mt-6 bg-amber-50 border-amber-200">
        <h3 className="font-semibold text-amber-800 mb-2">Before exporting</h3>
        <ul className="text-sm text-amber-700 space-y-1">
          <li>• Annotations without a class assignment may be excluded from export.</li>
          <li>• YOLO format supports bounding box (bbox) annotations only.</li>
          <li>• Images that have been moved or deleted will not be included in the ZIP.</li>
          <li>• Images already tagged train/val/test keep their original split regardless of ratio settings.</li>
        </ul>
      </div>
    </div>
  )
}
