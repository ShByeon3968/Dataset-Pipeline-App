import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useAppStore } from '../../store'
import { datasetsApi } from '../../api/datasets'

export default function Header() {
  const { selectedDataset, setSelectedDataset } = useAppStore()
  const { data } = useQuery({
    queryKey: ['datasets'],
    queryFn: datasetsApi.list,
  })

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-6 gap-4 shrink-0">
      <span className="text-sm text-gray-500">현재 데이터셋:</span>
      <div className="relative">
        <select
          className="appearance-none bg-gray-50 border border-gray-300 rounded-lg pl-3 pr-8 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={selectedDataset?.id ?? ''}
          onChange={(e) => {
            const ds = data?.items.find(d => d.id === Number(e.target.value))
            setSelectedDataset(ds ?? null)
          }}
        >
          <option value="">— 선택하세요 —</option>
          {data?.items.map(ds => (
            <option key={ds.id} value={ds.id}>{ds.name}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>
      {selectedDataset && (
        <span className="text-xs text-gray-400">
          이미지 {selectedDataset.image_count} | 주석 {selectedDataset.annotation_count} | 클래스 {selectedDataset.class_count}
        </span>
      )}
    </header>
  )
}
