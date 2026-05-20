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
    desc: 'COCO 2017 표준 형식. images, annotations, categories 구조.',
    color: 'bg-blue-50 border-blue-200 text-blue-700',
  },
  {
    id: 'yolo' as const,
    label: 'YOLO',
    icon: AlignLeft,
    desc: '이미지별 .txt 파일, 정규화 좌표 (cx cy w h). classes.txt 포함.',
    color: 'bg-green-50 border-green-200 text-green-700',
  },
  {
    id: 'voc' as const,
    label: 'Pascal VOC',
    icon: Code2,
    desc: '이미지별 XML 파일 (xmin ymin xmax ymax 절대 좌표).',
    color: 'bg-purple-50 border-purple-200 text-purple-700',
  },
]

export default function ExportPage() {
  const { selectedDataset } = useAppStore()
  const [loading, setLoading] = useState<string | null>(null)

  const handleExport = async (format: 'coco' | 'yolo' | 'voc') => {
    if (!selectedDataset) return toast.error('데이터셋을 먼저 선택하세요.')
    setLoading(format)
    try {
      exportApi.download(selectedDataset.id, format)
      toast.success(`${format.toUpperCase()} 내보내기 시작`)
    } catch (e) {
      toast.error('내보내기 실패')
    } finally {
      setTimeout(() => setLoading(null), 2000)
    }
  }

  if (!selectedDataset) {
    return <div className="card p-8 text-center text-gray-500">홈 화면에서 데이터셋을 선택하세요.</div>
  }

  return (
    <div>
      <h1 className="page-header">📤 데이터셋 내보내기</h1>
      <p className="page-subtitle">COCO JSON, YOLO, Pascal VOC 형식으로 변환하여 다운로드합니다.</p>

      <div className="card p-5 mb-6">
        <h2 className="font-semibold mb-1">현재 데이터셋: {selectedDataset.name}</h2>
        <p className="text-sm text-gray-500">
          이미지 {selectedDataset.image_count}개 · 주석 {selectedDataset.annotation_count}개 · 클래스 {selectedDataset.class_count}개
        </p>
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
              {loading === id ? '생성 중...' : `${label} 다운로드`}
            </button>
          </div>
        ))}
      </div>

      <div className="card p-5 mt-6 bg-amber-50 border-amber-200">
        <h3 className="font-semibold text-amber-800 mb-2">⚠️ 내보내기 전 확인사항</h3>
        <ul className="text-sm text-amber-700 space-y-1">
          <li>• 클래스가 미할당된 주석은 내보내기 결과에서 제외될 수 있습니다.</li>
          <li>• YOLO 형식은 바운딩 박스(bbox) 주석만 지원합니다.</li>
          <li>• 이미지 파일이 이동/삭제된 경우 ZIP에 포함되지 않습니다.</li>
        </ul>
      </div>
    </div>
  )
}
