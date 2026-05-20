import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  AlertTriangle, Copy, Filter, Trash2, X, CheckCircle,
  Star, Eye, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { refinementApi } from '../api/refinement'
import { annotationsApi } from '../api/annotations'
import { imagesApi } from '../api/images'
import { useAppStore } from '../store'
import type { DuplicateGroup, DuplicateImageMeta, LabelError, Annotation } from '../types'

// ── 이슈 레이블 / 색상 ──────────────────────────────────────────────
const ISSUE_LABELS: Record<string, string> = {
  class_unassigned:   '클래스 미할당',
  bbox_too_small:     'BBox 너무 작음',
  bbox_too_large:     'BBox 너무 큼',
  bbox_zero_area:     'BBox 면적 0',
  bbox_out_of_bounds: 'BBox 범위 초과',
}
const ISSUE_COLORS: Record<string, string> = {
  class_unassigned:   'bg-orange-100 text-orange-700',
  bbox_too_small:     'bg-blue-100 text-blue-700',
  bbox_too_large:     'bg-purple-100 text-purple-700',
  bbox_zero_area:     'bg-red-100 text-red-700',
  bbox_out_of_bounds: 'bg-rose-100 text-rose-700',
}

// ── 공통 모달 래퍼 ───────────────────────────────────────────────────
function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        {children}
      </div>
    </div>
  )
}

// ── 중복 검수 모달 ───────────────────────────────────────────────────
function DuplicateReviewModal({
  group,
  groupType,
  datasetId,
  onClose,
  onResolved,
}: {
  group: DuplicateGroup
  groupType: 'perceptual' | 'exact'
  datasetId: number
  onClose: () => void
  onResolved: () => void
}) {
  const qc = useQueryClient()
  const [toDelete, setToDelete] = useState<Set<number>>(new Set())
  const [representative, setRepresentative] = useState<number | null>(null)

  const resolveMutation = useMutation({
    mutationFn: (params: { keepId: number | null; deleteIds: number[] }) =>
      refinementApi.resolveDuplicate(datasetId, params.keepId, params.deleteIds),
    onSuccess: (res) => {
      toast.success(`${res.deleted}개 이미지 삭제 완료`)
      qc.invalidateQueries({ queryKey: ['duplicates', datasetId] })
      qc.invalidateQueries({ queryKey: ['datasets'] })
      onResolved()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleKeepRepresentative = (img: DuplicateImageMeta) => {
    const deleteIds = group.images.filter(i => i.id !== img.id).map(i => i.id)
    resolveMutation.mutate({ keepId: img.id, deleteIds })
  }

  const handleDeleteSelected = () => {
    if (toDelete.size === 0) return
    resolveMutation.mutate({ keepId: representative, deleteIds: Array.from(toDelete) })
  }

  const toggleDelete = (id: number) => {
    setToDelete(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (representative === id) setRepresentative(null)
  }

  const hashLabel = groupType === 'exact'
    ? `MD5: ${group.file_hash?.slice(0, 16)}…`
    : `pHash: ${group.phash?.slice(0, 16)}…`

  return (
    <Modal onClose={onClose}>
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Copy className="w-5 h-5 text-blue-500" />
            중복 이미지 검수
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {groupType === 'exact' ? '완전 중복 (MD5 일치)' : '유사 이미지 (perceptual hash)'}
            &nbsp;·&nbsp;{hashLabel}
            &nbsp;·&nbsp;{group.count}개
          </p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 이미지 목록 */}
      <div className="overflow-y-auto flex-1 p-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {group.images.map((img) => {
            const isMarked = toDelete.has(img.id)
            const isRep = representative === img.id
            return (
              <div
                key={img.id}
                className={`rounded-xl border-2 overflow-hidden transition-all ${
                  isMarked
                    ? 'border-red-400 opacity-60'
                    : isRep
                    ? 'border-yellow-400 shadow-md'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* 썸네일 */}
                <div className="aspect-square bg-gray-100 relative">
                  <img
                    src={imagesApi.getFileUrl(datasetId, img.id)}
                    alt={img.filename}
                    className="w-full h-full object-cover"
                  />
                  {isMarked && (
                    <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                      <Trash2 className="w-8 h-8 text-red-600 drop-shadow" />
                    </div>
                  )}
                  {isRep && (
                    <div className="absolute top-2 right-2 bg-yellow-400 text-white rounded-full p-1">
                      <Star className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>

                {/* 메타데이터 */}
                <div className="p-3 bg-white text-xs space-y-0.5">
                  <p className="font-medium text-gray-800 truncate" title={img.filename}>
                    {img.filename}
                  </p>
                  <p className="text-gray-400">
                    {img.width && img.height ? `${img.width} × ${img.height}` : '크기 미상'}
                    {img.format && ` · ${img.format.toUpperCase()}`}
                  </p>
                  {img.file_hash && (
                    <p className="text-gray-400 font-mono">MD5: {img.file_hash.slice(0, 12)}…</p>
                  )}
                  {img.phash && (
                    <p className="text-gray-400 font-mono">pHash: {img.phash.slice(0, 12)}…</p>
                  )}
                  {img.created_at && (
                    <p className="text-gray-400">
                      {new Date(img.created_at).toLocaleString('ko-KR', {
                        year: '2-digit', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>

                {/* 액션 버튼 */}
                <div className="flex border-t divide-x text-xs">
                  <button
                    onClick={() => handleKeepRepresentative(img)}
                    disabled={resolveMutation.isPending}
                    className="flex-1 py-2 text-center text-green-600 hover:bg-green-50 transition-colors font-medium disabled:opacity-40"
                    title="이 이미지만 유지하고 나머지 삭제"
                  >
                    <CheckCircle className="w-3.5 h-3.5 inline mr-1" />
                    대표 지정
                  </button>
                  <button
                    onClick={() => toggleDelete(img.id)}
                    className={`flex-1 py-2 text-center transition-colors font-medium ${
                      isMarked
                        ? 'text-blue-600 hover:bg-blue-50'
                        : 'text-red-500 hover:bg-red-50'
                    }`}
                  >
                    {isMarked ? (
                      <><Eye className="w-3.5 h-3.5 inline mr-1" />유지</>
                    ) : (
                      <><Trash2 className="w-3.5 h-3.5 inline mr-1" />삭제 표시</>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 하단 바 */}
      <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
        <p className="text-sm text-gray-500">
          {toDelete.size > 0
            ? `${toDelete.size}개 선택됨`
            : '이미지를 선택하거나 대표를 지정하세요'}
        </p>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-100 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={toDelete.size === 0 || resolveMutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 transition-colors font-medium"
          >
            {resolveMutation.isPending ? '처리 중…' : `${toDelete.size}개 삭제`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── 레이블 오류 검수 모달 ────────────────────────────────────────────
function LabelErrorReviewModal({
  error,
  allErrors,
  datasetId,
  onClose,
  onResolved,
}: {
  error: LabelError
  allErrors: LabelError[]
  datasetId: number
  onClose: () => void
  onResolved: (deletedAnnotationId: number) => void
}) {
  const qc = useQueryClient()
  const activeIdx = allErrors.findIndex(e => e.annotation_id === error.annotation_id)
  const [currentError, setCurrentError] = useState<LabelError>(error)

  // 같은 이슈 유형의 유사 샘플 (현재 항목 제외, 최대 4개)
  const similarSamples = allErrors
    .filter(e => e.issue === currentError.issue && e.annotation_id !== currentError.annotation_id)
    .slice(0, 4)

  // 해당 이미지의 어노테이션 목록
  const { data: imageData } = useQuery({
    queryKey: ['image-annotations', datasetId, currentError.image_id],
    queryFn: () => imagesApi.get(datasetId, currentError.image_id),
  })
  const annotations: Annotation[] = imageData?.annotations ?? []

  const deleteMutation = useMutation({
    mutationFn: (annotationId: number) => annotationsApi.delete(datasetId, currentError.image_id, annotationId),
    onSuccess: () => {
      toast.success('주석 삭제 완료')
      qc.invalidateQueries({ queryKey: ['label-errors', datasetId] })
      qc.invalidateQueries({ queryKey: ['image-annotations', datasetId, currentError.image_id] })
      onResolved(currentError.annotation_id)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const targetAnn = annotations.find(a => a.id === currentError.annotation_id)

  const navigate = (dir: 1 | -1) => {
    const nextIdx = activeIdx + dir
    if (nextIdx >= 0 && nextIdx < allErrors.length) {
      setCurrentError(allErrors[nextIdx])
    }
  }

  const imageUrl = imagesApi.getFileUrl(datasetId, currentError.image_id)

  return (
    <Modal onClose={onClose}>
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <div>
            <h2 className="font-semibold text-lg">레이블 오류 검수</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {activeIdx + 1} / {allErrors.length}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            disabled={activeIdx === 0}
            className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate(1)}
            disabled={activeIdx === allErrors.length - 1}
            className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 ml-2">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 본문 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 좌: 이미지 + BBox 오버레이 */}
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50 flex flex-col gap-4">
          {/* 이미지 뷰어 */}
          <div className="relative w-full rounded-xl overflow-hidden bg-black/5 border">
            <img
              src={imageUrl}
              alt={currentError.image_filename}
              className="w-full h-auto block"
            />
            {/* 모든 어노테이션 오버레이 */}
            {annotations.map(ann => {
              if (
                ann.bbox_x == null || ann.bbox_y == null ||
                ann.bbox_w == null || ann.bbox_h == null
              ) return null
              const isTarget = ann.id === currentError.annotation_id
              return (
                <div
                  key={ann.id}
                  style={{
                    position: 'absolute',
                    left: `${ann.bbox_x * 100}%`,
                    top: `${ann.bbox_y * 100}%`,
                    width: `${ann.bbox_w * 100}%`,
                    height: `${ann.bbox_h * 100}%`,
                    border: isTarget
                      ? '2.5px solid #ef4444'
                      : `1.5px solid ${ann.class_color ?? '#6366f1'}`,
                    boxSizing: 'border-box',
                  }}
                >
                  {isTarget && (
                    <span
                      className="absolute -top-5 left-0 text-[10px] font-bold bg-red-500 text-white px-1 py-0.5 rounded whitespace-nowrap"
                    >
                      {ISSUE_LABELS[currentError.issue] ?? currentError.issue}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* 유사 샘플 */}
          {similarSamples.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">
                같은 이슈 유형 샘플 ({similarSamples.length})
              </p>
              <div className="grid grid-cols-4 gap-2">
                {similarSamples.map(s => (
                  <button
                    key={s.annotation_id}
                    onClick={() => setCurrentError(s)}
                    className="rounded-lg overflow-hidden border hover:border-blue-400 transition-colors aspect-square bg-gray-100"
                  >
                    <img
                      src={imagesApi.getFileUrl(datasetId, s.image_id)}
                      alt={s.image_filename}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 우: 정보 패널 */}
        <div className="w-72 shrink-0 border-l overflow-y-auto p-4 flex flex-col gap-4 text-sm">
          {/* 이슈 배지 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">이슈 유형</p>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${ISSUE_COLORS[currentError.issue] ?? 'bg-gray-100 text-gray-600'}`}>
              <AlertTriangle className="w-3 h-3" />
              {ISSUE_LABELS[currentError.issue] ?? currentError.issue}
            </span>
          </div>

          {/* 신뢰도 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">신뢰도</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-red-400 rounded-full"
                  style={{ width: `${currentError.confidence * 100}%` }}
                />
              </div>
              <span className="text-xs font-mono text-gray-600">
                {(currentError.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          {/* 어노테이션 정보 */}
          {targetAnn && (
            <div>
              <p className="text-xs text-gray-400 mb-1">주석 정보</p>
              <div className="rounded-lg border overflow-hidden text-xs">
                {targetAnn.class_name && (
                  <div className="flex items-center gap-2 px-3 py-2 border-b">
                    {targetAnn.class_color && (
                      <div
                        className="w-3 h-3 rounded-full shrink-0 border"
                        style={{ background: targetAnn.class_color }}
                      />
                    )}
                    <span className="font-medium">{targetAnn.class_name}</span>
                  </div>
                )}
                {[
                  ['X', targetAnn.bbox_x],
                  ['Y', targetAnn.bbox_y],
                  ['W', targetAnn.bbox_w],
                  ['H', targetAnn.bbox_h],
                ].map(([label, val]) => (
                  val != null && (
                    <div key={label as string} className="flex justify-between px-3 py-1.5 even:bg-gray-50">
                      <span className="text-gray-400">{label}</span>
                      <span className="font-mono">{(val as number).toFixed(4)}</span>
                    </div>
                  )
                ))}
                {targetAnn.bbox_w != null && targetAnn.bbox_h != null && (
                  <div className="flex justify-between px-3 py-1.5 bg-gray-50">
                    <span className="text-gray-400">면적</span>
                    <span className="font-mono">{((targetAnn.bbox_w ?? 0) * (targetAnn.bbox_h ?? 0)).toFixed(6)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 상세 정보 (detail) */}
          {currentError.detail && Object.keys(currentError.detail).length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">상세</p>
              <div className="rounded-lg border overflow-hidden text-xs">
                {Object.entries(currentError.detail).map(([k, v]) => (
                  <div key={k} className="flex justify-between px-3 py-1.5 even:bg-gray-50">
                    <span className="text-gray-400">{k}</span>
                    <span className="font-mono">{typeof v === 'number' ? v.toFixed(6) : String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 파일 정보 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">파일</p>
            <p className="text-xs text-gray-600 break-all">{currentError.image_filename}</p>
          </div>

          {/* 구분선 */}
          <div className="flex-1" />

          {/* 액션 버튼 */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => navigate(1)}
              disabled={activeIdx === allErrors.length - 1}
              className="w-full py-2 rounded-lg border hover:bg-gray-50 text-xs font-medium disabled:opacity-30 transition-colors"
            >
              무시 (건너뛰기)
            </button>
            <button
              onClick={() => deleteMutation.mutate(currentError.annotation_id)}
              disabled={deleteMutation.isPending}
              className="w-full py-2 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 disabled:opacity-40 transition-colors"
            >
              {deleteMutation.isPending ? '삭제 중…' : '주석 삭제'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────────────
export default function RefinementPage() {
  const { selectedDataset } = useAppStore()
  const datasetId = selectedDataset?.id ?? 0

  const [tab, setTab] = useState<'duplicates' | 'bbox' | 'errors'>('duplicates')
  const [minArea, setMinArea] = useState(0)
  const [maxArea, setMaxArea] = useState(1)
  const [dupReviewGroup, setDupReviewGroup] = useState<{
    group: DuplicateGroup
    type: 'perceptual' | 'exact'
  } | null>(null)
  const [errorReviewItem, setErrorReviewItem] = useState<LabelError | null>(null)

  const qc = useQueryClient()

  // ── 중복 탐지 쿼리
  const dupQuery = useQuery({
    queryKey: ['duplicates', datasetId],
    queryFn: () => refinementApi.duplicates(datasetId),
    enabled: tab === 'duplicates' && datasetId > 0,
  })

  // ── BBox 필터 미리보기 쿼리
  const bboxPreviewQuery = useQuery({
    queryKey: ['bbox-preview', datasetId, minArea, maxArea],
    queryFn: () => refinementApi.filterBbox(datasetId, minArea, maxArea, true),
    enabled: tab === 'bbox' && datasetId > 0,
  })

  // ── 레이블 오류 쿼리
  const errorsQuery = useQuery({
    queryKey: ['label-errors', datasetId],
    queryFn: () => refinementApi.labelErrors(datasetId),
    enabled: tab === 'errors' && datasetId > 0,
  })

  // ── BBox 필터 실제 적용
  const bboxMutation = useMutation({
    mutationFn: () => refinementApi.filterBbox(datasetId, minArea, maxArea, false),
    onSuccess: (res) => {
      toast.success(`${res.to_delete}개 주석 삭제 완료`)
      qc.invalidateQueries({ queryKey: ['datasets'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!selectedDataset) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        데이터셋을 먼저 선택하세요
      </div>
    )
  }

  const perceptual: DuplicateGroup[] = dupQuery.data?.perceptual ?? []
  const exact: DuplicateGroup[]      = dupQuery.data?.exact ?? []
  const labelErrors: LabelError[]    = errorsQuery.data?.errors ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">데이터 정제</h1>

      {/* 탭 */}
      <div className="flex gap-1 mb-6 border-b">
        {(['duplicates', 'bbox', 'errors'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'duplicates' ? '중복 탐지' : t === 'bbox' ? 'BBox 필터' : '레이블 오류'}
          </button>
        ))}
      </div>

      {/* ── 중복 탐지 탭 */}
      {tab === 'duplicates' && (
        <div className="space-y-6">
          {dupQuery.isLoading && <p className="text-gray-400 text-sm">탐지 중…</p>}
          {dupQuery.isError && (
            <p className="text-red-500 text-sm">오류: {(dupQuery.error as Error).message}</p>
          )}

          {/* 유사 이미지 (pHash) */}
          {perceptual.length > 0 && (
            <section>
              <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Copy className="w-4 h-4 text-blue-400" />
                유사 이미지 (pHash)
                <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                  {perceptual.length}그룹
                </span>
              </h2>
              <div className="divide-y border rounded-xl overflow-hidden">
                {perceptual.map((g, i) => (
                  <button
                    key={i}
                    onClick={() => setDupReviewGroup({ group: g, type: 'perceptual' })}
                    className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    {/* 미니 썸네일 4개 */}
                    <div className="flex gap-1 shrink-0">
                      {g.images.slice(0, 4).map(img => (
                        <div key={img.id} className="w-10 h-10 rounded bg-gray-100 overflow-hidden">
                          <img
                            src={imagesApi.getFileUrl(datasetId, img.id)}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700">{g.count}개 유사 이미지</p>
                      <p className="text-xs text-gray-400 font-mono truncate">
                        pHash: {g.phash?.slice(0, 20)}…
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* 완전 중복 (MD5) */}
          {exact.length > 0 && (
            <section>
              <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Copy className="w-4 h-4 text-red-400" />
                완전 중복 (MD5)
                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                  {exact.length}그룹
                </span>
              </h2>
              <div className="divide-y border rounded-xl overflow-hidden">
                {exact.map((g, i) => (
                  <button
                    key={i}
                    onClick={() => setDupReviewGroup({ group: g, type: 'exact' })}
                    className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex gap-1 shrink-0">
                      {g.images.slice(0, 4).map(img => (
                        <div key={img.id} className="w-10 h-10 rounded bg-gray-100 overflow-hidden">
                          <img
                            src={imagesApi.getFileUrl(datasetId, img.id)}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700">{g.count}개 완전 중복</p>
                      <p className="text-xs text-gray-400 font-mono truncate">
                        MD5: {g.file_hash?.slice(0, 20)}…
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {dupQuery.isSuccess && perceptual.length === 0 && exact.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-400" />
              <p>중복 이미지가 없습니다</p>
            </div>
          )}
        </div>
      )}

      {/* ── BBox 필터 탭 */}
      {tab === 'bbox' && (
        <div className="space-y-6 max-w-lg">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-gray-600">최소 면적</span>
              <input
                type="number" step="0.001" min="0" max="1"
                value={minArea}
                onChange={e => setMinArea(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600">최대 면적</span>
              <input
                type="number" step="0.001" min="0" max="1"
                value={maxArea}
                onChange={e => setMaxArea(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </label>
          </div>

          {bboxPreviewQuery.data && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm">
              <p className="font-medium text-amber-700 flex items-center gap-2">
                <Filter className="w-4 h-4" />
                미리보기
              </p>
              <p className="text-amber-600 mt-1">
                전체 {bboxPreviewQuery.data.total_annotations}개 중&nbsp;
                <span className="font-bold">{bboxPreviewQuery.data.to_delete}개</span> 삭제 예정
              </p>
            </div>
          )}

          <button
            onClick={() => bboxMutation.mutate()}
            disabled={bboxMutation.isPending || (bboxPreviewQuery.data?.to_delete ?? 0) === 0}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-500 text-white rounded-xl font-medium text-sm hover:bg-red-600 disabled:opacity-40 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {bboxMutation.isPending ? '삭제 중…' : '필터 적용 (삭제)'}
          </button>
        </div>
      )}

      {/* ── 레이블 오류 탭 */}
      {tab === 'errors' && (
        <div>
          {errorsQuery.isLoading && <p className="text-gray-400 text-sm">분석 중…</p>}
          {errorsQuery.isError && (
            <p className="text-red-500 text-sm">오류: {(errorsQuery.error as Error).message}</p>
          )}

          {errorsQuery.data && (
            <>
              {/* 요약 */}
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(errorsQuery.data.issue_summary as Record<string, number>).map(([issue, cnt]) => (
                  <span
                    key={issue}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium ${ISSUE_COLORS[issue] ?? 'bg-gray-100 text-gray-600'}`}
                  >
                    {ISSUE_LABELS[issue] ?? issue}: {cnt}
                  </span>
                ))}
                {errorsQuery.data.total_errors === 0 && (
                  <span className="text-xs text-gray-400">오류 없음</span>
                )}
              </div>

              {/* 오류 목록 */}
              {labelErrors.length > 0 && (
                <div className="divide-y border rounded-xl overflow-hidden">
                  {labelErrors.map((err) => (
                    <button
                      key={err.annotation_id}
                      onClick={() => setErrorReviewItem(err)}
                      className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="w-10 h-10 rounded bg-gray-100 overflow-hidden shrink-0">
                        <img
                          src={imagesApi.getFileUrl(datasetId, err.image_id)}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-700 truncate">
                          {err.image_filename}
                        </p>
                        <p className="text-xs text-gray-400">
                          주석 #{err.annotation_id}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${ISSUE_COLORS[err.issue] ?? 'bg-gray-100 text-gray-600'}`}>
                        {ISSUE_LABELS[err.issue] ?? err.issue}
                      </span>
                      <span className="text-xs text-gray-400 font-mono shrink-0">
                        {(err.confidence * 100).toFixed(0)}%
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {labelErrors.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-400" />
                  <p>레이블 오류가 없습니다</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 중복 검수 모달 */}
      {dupReviewGroup && (
        <DuplicateReviewModal
          group={dupReviewGroup.group}
          groupType={dupReviewGroup.type}
          datasetId={datasetId}
          onClose={() => setDupReviewGroup(null)}
          onResolved={() => setDupReviewGroup(null)}
        />
      )}

      {/* ── 레이블 오류 검수 모달 */}
      {errorReviewItem && (
        <LabelErrorReviewModal
          error={errorReviewItem}
          allErrors={labelErrors}
          datasetId={datasetId}
          onClose={() => setErrorReviewItem(null)}
          onResolved={(deletedId) => {
            // 삭제 후 다음 항목으로 이동하거나 닫기
            const remaining = labelErrors.filter(e => e.annotation_id !== deletedId)
            const nextIdx = labelErrors.findIndex(e => e.annotation_id === errorReviewItem.annotation_id)
            if (remaining.length === 0) {
              setErrorReviewItem(null)
            } else {
              const safeIdx = Math.min(nextIdx, remaining.length - 1)
              setErrorReviewItem(remaining[safeIdx])
            }
          }}
        />
      )}
    </div>
  )
}
