import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Upload, Tag, BarChart2, Scissors, GitMerge, Download, Plus, AlertCircle, RefreshCw, Trash2 } from 'lucide-react'
import { datasetsApi } from '../api/datasets'
import { useAppStore } from '../store'

const steps = [
  { to: '/upload', icon: Upload, label: '1. 업로드', desc: '로컬 이미지 업로드 또는 Roboflow에서 가져오기', color: 'bg-blue-50 text-blue-600' },
  { to: '/labeling', icon: Tag, label: '2. 레이블링', desc: '바운딩 박스를 그리고 클래스를 할당', color: 'bg-purple-50 text-purple-600' },
  { to: '/analysis', icon: BarChart2, label: '3. 분석', desc: '클래스 분포, BBox 통계, 임베딩 시각화', color: 'bg-green-50 text-green-600' },
  { to: '/refinement', icon: Scissors, label: '4. 정제', desc: '중복 제거, 이상치 필터링, 레이블 오류 수정', color: 'bg-orange-50 text-orange-600' },
  { to: '/ontology', icon: GitMerge, label: '5. 온톨로지', desc: '"Person" + "Human" → "Human" 클래스 통합', color: 'bg-pink-50 text-pink-600' },
  { to: '/export', icon: Download, label: '6. 내보내기', desc: 'COCO JSON / YOLO / Pascal VOC 형식 변환', color: 'bg-teal-50 text-teal-600' },
]

export default function Home() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['datasets'],
    queryFn: datasetsApi.list,
    retry: 1,
    retryDelay: 2000,
  })
  const { setSelectedDataset } = useAppStore()

  const handleDelete = async (id: number, name: string) => {
    if (window.confirm(`데이터셋 "${name}"을(를) 삭제하시겠습니까?\n관련 이미지와 주석 데이터가 모두 삭제됩니다.`)) {
      try {
        await datasetsApi.delete(id)
        refetch()
      } catch (err) {
        alert('삭제 중 오류가 발생했습니다.')
      }
    }
  }

  return (
    <div>
      <h1 className="page-header">데이터셋 관리 파이프라인</h1>
      <p className="page-subtitle">ML 엔지니어를 위한 원스톱 데이터셋 구축·분석·정제 도구</p>

      {/* Steps */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {steps.map(({ to, icon: Icon, label, desc, color }) => (
          <Link key={to} to={to} className="card p-4 hover:shadow-md transition-shadow">
            <div className={`inline-flex p-2 rounded-lg ${color} mb-3`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="font-semibold text-sm mb-1">{label}</div>
            <div className="text-xs text-gray-500">{desc}</div>
          </Link>
        ))}
      </div>

      {/* Dataset list */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg">데이터셋 목록</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
              title="새로고침"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <Link to="/upload" className="btn-primary flex items-center gap-1 text-sm">
              <Plus className="w-4 h-4" /> 새 데이터셋
            </Link>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3 py-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse flex items-center justify-between py-3">
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-40" />
                  <div className="h-3 bg-gray-100 rounded w-56" />
                </div>
                <div className="h-8 bg-gray-200 rounded w-16" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="flex flex-col items-center py-8 gap-3">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm text-red-600 font-medium">데이터셋을 불러오지 못했습니다</p>
            <p className="text-xs text-gray-400 text-center max-w-sm">
              {(error as Error)?.message || '백엔드 서버가 실행 중인지 확인하세요.'}
            </p>
            <button
              onClick={() => refetch()}
              className="btn-secondary text-sm flex items-center gap-1 mt-1"
            >
              <RefreshCw className="w-3.5 h-3.5" /> 다시 시도
            </button>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && !data?.items.length && (
          <p className="text-sm text-gray-500 text-center py-8">
            데이터셋이 없습니다. 업로드 페이지에서 시작하세요.
          </p>
        )}

        {/* List */}
        <div className="divide-y divide-gray-100">
          {data?.items.map(ds => (
            <div key={ds.id} className="py-3 flex items-center justify-between group">
              <div>
                <span className="font-medium">{ds.name}</span>
                <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                  {ds.source.toUpperCase()}
                </span>
                <p className="text-xs text-gray-400 mt-0.5">
                  이미지 {ds.image_count} · 주석 {ds.annotation_count} · 클래스 {ds.class_count}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDelete(ds.id, ds.name)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  title="삭제"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedDataset(ds)}
                  className="btn-secondary text-xs"
                >
                  선택
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
