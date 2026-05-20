import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Stage, Layer, Rect, Image as KonvaImage } from 'react-konva'
import useImage from 'use-image'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Vector2d } from 'konva/lib/types'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, Plus, Trash2, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { imagesApi } from '../api/images'
import { annotationsApi } from '../api/annotations'
import { classesApi } from '../api/classes'
import { useAppStore } from '../store'
import type { Annotation } from '../types'

const CANVAS_W = 700
const CANVAS_H = 500
const PAGE_SIZE = 10   // 한 번에 불러올 이미지 수

interface BBox { x: number; y: number; w: number; h: number }
interface SelectedClass { id: number; color: string }

// ── BBox 캔버스 컴포넌트 ──────────────────────────────────────────
function BBoxCanvas({
  imageUrl, annotations, selectedClass, onAdd,
}: {
  imageUrl: string
  annotations: Annotation[]
  selectedClass: SelectedClass | null
  onAdd: (bbox: BBox) => void
}) {
  const [img] = useImage(imageUrl, 'anonymous')
  const [drawing, setDrawing] = useState(false)
  const [startPos, setStartPos] = useState<Vector2d>({ x: 0, y: 0 })
  const [currentRect, setCurrentRect] = useState<BBox | null>(null)

  const scale = img ? Math.min(CANVAS_W / img.width, CANVAS_H / img.height) : 1
  const imgW = img ? img.width * scale : CANVAS_W
  const imgH = img ? img.height * scale : CANVAS_H

  const getPos = (e: KonvaEventObject<MouseEvent>): Vector2d => {
    const stage = e.target.getStage()
    return stage ? (stage.getPointerPosition() ?? { x: 0, y: 0 }) : { x: 0, y: 0 }
  }

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const pos = getPos(e)
    setDrawing(true)
    setStartPos(pos)
  }

  const handleMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    if (!drawing) return
    const pos = getPos(e)
    setCurrentRect({
      x: Math.min(pos.x, startPos.x),
      y: Math.min(pos.y, startPos.y),
      w: Math.abs(pos.x - startPos.x),
      h: Math.abs(pos.y - startPos.y),
    })
  }

  const handleMouseUp = () => {
    if (drawing && currentRect && currentRect.w > 5 && currentRect.h > 5) {
      onAdd({
        x: currentRect.x / imgW,
        y: currentRect.y / imgH,
        w: currentRect.w / imgW,
        h: currentRect.h / imgH,
      })
    }
    setDrawing(false)
    setCurrentRect(null)
  }

  return (
    <Stage
      width={CANVAS_W}
      height={CANVAS_H}
      style={{ cursor: 'crosshair', border: '1px solid #e5e7eb', borderRadius: 8 }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <Layer>
        {img && <KonvaImage image={img} width={imgW} height={imgH} />}
        {annotations.map((ann) =>
          ann.bbox_x != null ? (
            <Rect
              key={ann.id}
              x={ann.bbox_x * imgW}
              y={(ann.bbox_y ?? 0) * imgH}
              width={(ann.bbox_w ?? 0) * imgW}
              height={(ann.bbox_h ?? 0) * imgH}
              stroke={ann.class_color ?? '#FF6B6B'}
              strokeWidth={2}
              fill={`${ann.class_color ?? '#FF6B6B'}22`}
            />
          ) : null
        )}
        {currentRect && (
          <Rect
            x={currentRect.x} y={currentRect.y}
            width={currentRect.w} height={currentRect.h}
            stroke={selectedClass?.color ?? '#3B82F6'}
            strokeWidth={2} dash={[5, 3]}
          />
        )}
      </Layer>
    </Stage>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────────
export default function LabelingPage() {
  const qc = useQueryClient()
  const { selectedDataset } = useAppStore()

  // globalIndex: 전체 이미지 목록에서의 절대 위치 (0-indexed)
  const [globalIndex, setGlobalIndex] = useState(0)
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null)
  const [newClassName, setNewClassName] = useState('')

  // 현재 페이지 번호와 페이지 내 로컬 인덱스
  const page = useMemo(() => Math.floor(globalIndex / PAGE_SIZE), [globalIndex])
  const localIndex = useMemo(() => globalIndex % PAGE_SIZE, [globalIndex])

  // 현재 페이지의 이미지 목록 fetch
  const { data: imagesData, isFetching: fetchingImages } = useQuery({
    queryKey: ['images', selectedDataset?.id, page],
    queryFn: () => imagesApi.list(selectedDataset!.id, page * PAGE_SIZE, PAGE_SIZE),
    enabled: !!selectedDataset,
    placeholderData: (prev) => prev,  // 페이지 전환 시 이전 데이터 유지
  })

  const { data: classes } = useQuery({
    queryKey: ['classes', selectedDataset?.id],
    queryFn: () => classesApi.list(selectedDataset!.id),
    enabled: !!selectedDataset,
  })

  const total = imagesData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentImage = imagesData?.items[localIndex]

  // 주석 fetch
  const { data: annotations, refetch: refetchAnnotations } = useQuery({
    queryKey: ['annotations', selectedDataset?.id, currentImage?.id],
    queryFn: () => annotationsApi.list(selectedDataset!.id, currentImage!.id),
    enabled: !!selectedDataset && !!currentImage,
  })

  // ── 네비게이션 핸들러 ──────────────────────────────────────────
  const goPrev = () => setGlobalIndex((i) => Math.max(0, i - 1))
  const goNext = () => setGlobalIndex((i) => Math.min(total - 1, i + 1))

  const goFirstPage = () => setGlobalIndex(0)
  const goLastPage = () => setGlobalIndex(Math.max(0, total - 1))

  const goToPage = (p: number) => {
    const clamped = Math.max(0, Math.min(totalPages - 1, p))
    setGlobalIndex(clamped * PAGE_SIZE)
  }

  // ── Mutations ─────────────────────────────────────────────────
  const addAnn = useMutation({
    mutationFn: (bbox: BBox) =>
      annotationsApi.create(selectedDataset!.id, currentImage!.id, {
        image_id: currentImage!.id,
        class_id: selectedClassId,
        bbox_x: bbox.x, bbox_y: bbox.y,
        bbox_w: bbox.w, bbox_h: bbox.h,
        annotation_type: 'bbox',
      }),
    onSuccess: () => refetchAnnotations(),
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteAnn = useMutation({
    mutationFn: (annId: number) =>
      annotationsApi.delete(selectedDataset!.id, currentImage!.id, annId),
    onSuccess: () => refetchAnnotations(),
  })

  const deleteImage = useMutation({
    mutationFn: () => imagesApi.delete(selectedDataset!.id, currentImage!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      qc.invalidateQueries({ queryKey: ['images', selectedDataset?.id] })
      toast.success('이미지 삭제 완료')
      setGlobalIndex((i) => Math.max(0, i - 1))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createClass = useMutation({
    mutationFn: () => classesApi.create(selectedDataset!.id, newClassName),
    onSuccess: (cls) => {
      qc.invalidateQueries({ queryKey: ['classes', selectedDataset?.id] })
      setSelectedClassId(cls.id)
      setNewClassName('')
      toast.success(`클래스 '${cls.name}' 생성`)
    },
  })

  if (!selectedDataset) {
    return (
      <div className="card p-8 text-center text-gray-500">
        홈 화면에서 데이터셋을 선택하세요.
      </div>
    )
  }

  const selectedClassObj = classes?.find((c) => c.id === selectedClassId) ?? null

  return (
    <div>
      <h1 className="page-header">🏷️ 레이블링</h1>
      <p className="page-subtitle">이미지에 바운딩 박스를 그리고 클래스를 할당합니다.</p>

      <div className="flex gap-6">
        {/* ── 캔버스 영역 ──────────────────────────────────────── */}
        <div className="flex-1">
          {/* 이미지 네비게이션 */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {/* 첫 이미지 */}
            <button
              onClick={goFirstPage}
              disabled={globalIndex === 0}
              className="btn-secondary disabled:opacity-40 p-1.5"
              title="첫 이미지"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            {/* 이전 이미지 */}
            <button
              onClick={goPrev}
              disabled={globalIndex === 0}
              className="btn-secondary disabled:opacity-40 p-1.5"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            {/* 현재 위치 / 전체 */}
            <span className="text-sm text-gray-600 min-w-[80px] text-center">
              {total > 0 ? globalIndex + 1 : 0} / {total}
            </span>

            {/* 다음 이미지 */}
            <button
              onClick={goNext}
              disabled={globalIndex >= total - 1}
              className="btn-secondary disabled:opacity-40 p-1.5"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            {/* 마지막 이미지 */}
            <button
              onClick={goLastPage}
              disabled={globalIndex >= total - 1}
              className="btn-secondary disabled:opacity-40 p-1.5"
              title="마지막 이미지"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>

            {/* 페이지 점프 */}
            <div className="flex items-center gap-1 ml-2 text-xs text-gray-500">
              <span>페이지</span>
              <input
                type="number"
                min={1} max={totalPages}
                value={page + 1}
                onChange={(e) => goToPage(Number(e.target.value) - 1)}
                className="w-12 border border-gray-300 rounded px-1 py-0.5 text-center text-xs"
              />
              <span>/ {totalPages}</span>
            </div>

            {/* 파일명 */}
            <span className="text-xs text-gray-400 ml-2 truncate max-w-[200px]" title={currentImage?.filename}>
              {fetchingImages ? '불러오는 중...' : (currentImage?.filename ?? '—')}
            </span>

            {/* 이미지 삭제 */}
            {currentImage && (
              <button
                onClick={() => {
                  if (confirm(`'${currentImage.filename}' 을(를) 삭제할까요?\n연결된 주석도 함께 삭제됩니다.`))
                    deleteImage.mutate()
                }}
                disabled={deleteImage.isPending}
                className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-500 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-40 transition-colors"
                title="현재 이미지 삭제"
              >
                <Trash2 className="w-3.5 h-3.5" />
                이미지 삭제
              </button>
            )}
          </div>

          {/* 캔버스 */}
          {currentImage ? (
            <BBoxCanvas
              imageUrl={imagesApi.getFileUrl(currentImage.dataset_id, currentImage.id)}
              annotations={annotations ?? []}
              selectedClass={selectedClassObj ? { id: selectedClassObj.id, color: selectedClassObj.color } : null}
              onAdd={(bbox) => addAnn.mutate(bbox)}
            />
          ) : (
            <div
              style={{ width: CANVAS_W, height: CANVAS_H }}
              className="flex items-center justify-center bg-gray-50 border rounded-lg text-gray-400 text-sm"
            >
              {total === 0 ? '이미지를 먼저 업로드하세요' : '이미지를 불러오는 중...'}
            </div>
          )}
        </div>

        {/* ── 사이드 패널 ──────────────────────────────────────── */}
        <div className="w-64 shrink-0 space-y-4">
          {/* 클래스 선택 */}
          <div className="card p-4">
            <h3 className="font-semibold text-sm mb-3">클래스 선택</h3>
            <div className="space-y-1 mb-3 max-h-48 overflow-y-auto">
              {classes?.map((cls) => (
                <button
                  key={cls.id}
                  onClick={() => setSelectedClassId(cls.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                    selectedClassId === cls.id
                      ? 'bg-blue-50 border border-blue-300'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ background: cls.color }}
                  />
                  <span className="truncate">{cls.name}</span>
                </button>
              ))}
              {(!classes || classes.length === 0) && (
                <p className="text-xs text-gray-400 text-center py-2">클래스 없음</p>
              )}
            </div>

            {/* 새 클래스 추가 */}
            <div className="flex gap-1">
              <input
                type="text"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newClassName.trim() && createClass.mutate()}
                placeholder="새 클래스명"
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button
                onClick={() => createClass.mutate()}
                disabled={!newClassName.trim() || createClass.isPending}
                className="btn-primary p-1.5 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 주석 목록 */}
          <div className="card p-4">
            <h3 className="font-semibold text-sm mb-3">
              주석 목록
              <span className="ml-1 text-gray-400 font-normal">({annotations?.length ?? 0})</span>
            </h3>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {annotations?.map((ann) => (
                <div
                  key={ann.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-50 text-xs group"
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: ann.class_color ?? '#94a3b8' }}
                  />
                  <span className="flex-1 truncate text-gray-700">
                    {ann.class_name ?? '미분류'}
                  </span>
                  <button
                    onClick={() => deleteAnn.mutate(ann.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {(!annotations || annotations.length === 0) && (
                <p className="text-xs text-gray-400 text-center py-2">주석 없음</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
