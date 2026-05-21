import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Stage, Layer, Rect, Image as KonvaImage } from 'react-konva'
import useImage from 'use-image'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Vector2d } from 'konva/lib/types'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, Plus, Trash2, ChevronsLeft, ChevronsRight, Cpu } from 'lucide-react'
import { imagesApi } from '../api/images'
import { annotationsApi } from '../api/annotations'
import { classesApi } from '../api/classes'
import { useAppStore } from '../store'
import type { Annotation } from '../types'

const CANVAS_W = 700
const CANVAS_H = 500
const PAGE_SIZE = 10

// Auto-label annotation stroke color (orange)
const AUTO_LABEL_COLOR = '#F97316'

interface BBox { x: number; y: number; w: number; h: number }
interface SelectedClass { id: number; color: string }

// Returns stroke color and dash pattern based on whether annotation is auto-generated
function getAnnStyle(ann: Annotation): { stroke: string; dash: number[] | undefined } {
  if (ann.is_auto_generated) {
    return { stroke: AUTO_LABEL_COLOR, dash: [6, 3] }
  }
  return { stroke: ann.class_color ?? '#FF6B6B', dash: undefined }
}

// ── BBox Canvas ──────────────────────────────────────────────────
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
        {annotations.map((ann) => {
          if (ann.bbox_x == null) return null
          const { stroke, dash } = getAnnStyle(ann)
          const fillColor = ann.is_auto_generated
            ? `${AUTO_LABEL_COLOR}1A`
            : `${ann.class_color ?? '#FF6B6B'}22`
          return (
            <Rect
              key={ann.id}
              x={ann.bbox_x * imgW}
              y={(ann.bbox_y ?? 0) * imgH}
              width={(ann.bbox_w ?? 0) * imgW}
              height={(ann.bbox_h ?? 0) * imgH}
              stroke={stroke}
              strokeWidth={ann.is_auto_generated ? 1.5 : 2}
              dash={dash}
              fill={fillColor}
            />
          )
        })}
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

// ── Main Page ────────────────────────────────────────────────────
export default function LabelingPage() {
  const qc = useQueryClient()
  const { selectedDataset } = useAppStore()

  const [globalIndex, setGlobalIndex] = useState(0)
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null)
  const [newClassName, setNewClassName] = useState('')

  const page = useMemo(() => Math.floor(globalIndex / PAGE_SIZE), [globalIndex])
  const localIndex = useMemo(() => globalIndex % PAGE_SIZE, [globalIndex])

  const { data: imagesData, isFetching: fetchingImages } = useQuery({
    queryKey: ['images', selectedDataset?.id, page],
    queryFn: () => imagesApi.list(selectedDataset!.id, page * PAGE_SIZE, PAGE_SIZE),
    enabled: !!selectedDataset,
    placeholderData: (prev) => prev,
  })

  const { data: classes } = useQuery({
    queryKey: ['classes', selectedDataset?.id],
    queryFn: () => classesApi.list(selectedDataset!.id),
    enabled: !!selectedDataset,
  })

  const total = imagesData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentImage = imagesData?.items[localIndex]

  const { data: annotations, refetch: refetchAnnotations } = useQuery({
    queryKey: ['annotations', selectedDataset?.id, currentImage?.id],
    queryFn: () => annotationsApi.list(selectedDataset!.id, currentImage!.id),
    enabled: !!selectedDataset && !!currentImage,
  })

  // Annotation counts by type (for summary)
  const manualCount = annotations?.filter((a) => !a.is_auto_generated).length ?? 0
  const autoCount = annotations?.filter((a) => a.is_auto_generated).length ?? 0

  // ── Navigation ───────────────────────────────────────────────
  const goPrev = () => setGlobalIndex((i) => Math.max(0, i - 1))
  const goNext = () => setGlobalIndex((i) => Math.min(total - 1, i + 1))
  const goFirstPage = () => setGlobalIndex(0)
  const goLastPage = () => setGlobalIndex(Math.max(0, total - 1))
  const goToPage = (p: number) => {
    const clamped = Math.max(0, Math.min(totalPages - 1, p))
    setGlobalIndex(clamped * PAGE_SIZE)
  }

  // ── Mutations ────────────────────────────────────────────────
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
      toast.success('Image deleted.')
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
      toast.success(`Class '${cls.name}' created.`)
    },
  })

  if (!selectedDataset) {
    return (
      <div className="card p-8 text-center text-gray-500">
        Select a dataset from the home screen.
      </div>
    )
  }

  const selectedClassObj = classes?.find((c) => c.id === selectedClassId) ?? null

  return (
    <div>
      <h1 className="page-header">Labeling</h1>
      <p className="page-subtitle">Draw bounding boxes and assign classes to images.</p>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-3 rounded border-2 border-blue-400" style={{ background: '#3B82F622' }} />
          <span>Manual label</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-6 h-3 rounded"
            style={{
              border: `2px dashed ${AUTO_LABEL_COLOR}`,
              background: `${AUTO_LABEL_COLOR}1A`,
            }}
          />
          <span>Auto label (AI)</span>
        </div>
      </div>

      <div className="flex gap-6">
        {/* ── Canvas area ──────────────────────────────────── */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <button
              onClick={goFirstPage}
              disabled={globalIndex === 0}
              className="btn-secondary disabled:opacity-40 p-1.5"
              title="First image"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={goPrev}
              disabled={globalIndex === 0}
              className="btn-secondary disabled:opacity-40 p-1.5"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <span className="text-sm text-gray-600 min-w-[80px] text-center">
              {total > 0 ? globalIndex + 1 : 0} / {total}
            </span>

            <button
              onClick={goNext}
              disabled={globalIndex >= total - 1}
              className="btn-secondary disabled:opacity-40 p-1.5"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button
              onClick={goLastPage}
              disabled={globalIndex >= total - 1}
              className="btn-secondary disabled:opacity-40 p-1.5"
              title="Last image"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 ml-2 text-xs text-gray-500">
              <span>Page</span>
              <input
                type="number"
                min={1} max={totalPages}
                value={page + 1}
                onChange={(e) => goToPage(Number(e.target.value) - 1)}
                className="w-12 border border-gray-300 rounded px-1 py-0.5 text-center text-xs"
              />
              <span>/ {totalPages}</span>
            </div>

            <span className="text-xs text-gray-400 ml-2 truncate max-w-[200px]" title={currentImage?.filename}>
              {fetchingImages ? 'Loading...' : (currentImage?.filename ?? '-')}
            </span>

            {currentImage && (
              <button
                onClick={() => {
                  if (confirm(`Delete '${currentImage.filename}'?\nAll annotations will also be removed.`))
                    deleteImage.mutate()
                }}
                disabled={deleteImage.isPending}
                className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-500 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-40 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete image
              </button>
            )}
          </div>

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
              {total === 0 ? 'Upload images first.' : 'Loading image...'}
            </div>
          )}
        </div>

        {/* ── Side panel ───────────────────────────────────── */}
        <div className="w-64 shrink-0 space-y-4">
          {/* Class selector */}
          <div className="card p-4">
            <h3 className="font-semibold text-sm mb-3">Class</h3>
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
                <p className="text-xs text-gray-400 text-center py-2">No classes</p>
              )}
            </div>

            <div className="flex gap-1">
              <input
                type="text"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newClassName.trim() && createClass.mutate()}
                placeholder="New class name"
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

          {/* Annotation list */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">
                Annotations
                <span className="ml-1 text-gray-400 font-normal">({annotations?.length ?? 0})</span>
              </h3>
              {autoCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-orange-500 font-medium">
                  <Cpu className="w-3 h-3" />
                  {autoCount} AI
                </span>
              )}
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {annotations?.map((ann) => {
                const isAuto = ann.is_auto_generated
                return (
                  <div
                    key={ann.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs group ${
                      isAuto ? 'bg-orange-50' : 'bg-gray-50'
                    }`}
                  >
                    {/* Color dot */}
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0 ring-1"
                      style={{
                        background: isAuto ? AUTO_LABEL_COLOR : (ann.class_color ?? '#94a3b8'),
                        ringColor: isAuto ? AUTO_LABEL_COLOR : 'transparent',
                      }}
                    />

                    {/* Class name */}
                    <span className="flex-1 truncate text-gray-700">
                      {ann.class_name ?? 'Unlabeled'}
                    </span>

                    {/* AI badge + confidence */}
                    {isAuto && (
                      <span className="flex items-center gap-0.5 px-1 py-0.5 rounded text-orange-600 bg-orange-100 font-medium shrink-0">
                        <Cpu className="w-2.5 h-2.5" />
                        {ann.confidence != null
                          ? `${Math.round(ann.confidence * 100)}%`
                          : 'AI'}
                      </span>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={() => deleteAnn.mutate(ann.id)}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
              {(!annotations || annotations.length === 0) && (
                <p className="text-xs text-gray-400 text-center py-2">No annotations</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
