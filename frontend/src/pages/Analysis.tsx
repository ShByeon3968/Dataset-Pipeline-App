import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { Sliders, CheckCircle2, AlertTriangle, Copy, Trash2, RefreshCw, Loader2 } from 'lucide-react'
import { useAppStore } from '../store'
import { analysisApi, type EmbeddingPoint, type OutlierItem, type DuplicateCandidate } from '../api/analysis'
import { imagesApi } from '../api/images'

// ── StatCard ──────────────────────────────────────────────────────────
function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4 text-center">
      <div className="text-2xl font-bold text-blue-600">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

// ── 임베딩 산점도 (Canvas + 이미지 툴팁) ─────────────────────────────
interface ScatterTooltip {
  x: number
  y: number
  point: EmbeddingPoint
}

function EmbeddingScatter({
  points,
  method,
  embeddingModel,
}: {
  points: EmbeddingPoint[]
  method: string
  embeddingModel: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tooltip, setTooltip] = useState<ScatterTooltip | null>(null)

  // 좌표 변환 캐시
  const projRef = useRef<{ toX: (v: number) => number; toY: (v: number) => number } | null>(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || points.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    const PAD = 40

    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    const xMin = Math.min(...xs), xMax = Math.max(...xs)
    const yMin = Math.min(...ys), yMax = Math.max(...ys)
    const xRange = xMax - xMin || 1
    const yRange = yMax - yMin || 1

    const toX = (v: number) => PAD + ((v - xMin) / xRange) * (W - PAD * 2)
    const toY = (v: number) => H - PAD - ((v - yMin) / yRange) * (H - PAD * 2)
    projRef.current = { toX, toY }

    ctx.clearRect(0, 0, W, H)

    // 그리드
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 1
    for (let i = 0; i <= 5; i++) {
      const gx = PAD + (i / 5) * (W - PAD * 2)
      const gy = PAD + (i / 5) * (H - PAD * 2)
      ctx.beginPath(); ctx.moveTo(gx, PAD); ctx.lineTo(gx, H - PAD); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(PAD, gy); ctx.lineTo(W - PAD, gy); ctx.stroke()
    }

    // 포인트 그리기
    points.forEach(p => {
      const color = (p.class_colors && p.class_colors.length > 0)
        ? p.class_colors[0]
        : '#6b7280'
      ctx.beginPath()
      ctx.arc(toX(p.x), toY(p.y), 5, 0, Math.PI * 2)
      ctx.fillStyle = color + 'cc'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.stroke()
    })
  }, [points])

  useEffect(() => { redraw() }, [redraw])

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || points.length === 0 || !projRef.current) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const mx = (e.clientX - rect.left) * scaleX
    const my = (e.clientY - rect.top) * scaleY
    const { toX, toY } = projRef.current

    const hit = points.find(p => {
      const dx = toX(p.x) - mx
      const dy = toY(p.y) - my
      return Math.sqrt(dx * dx + dy * dy) < 8
    })

    if (hit) {
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, point: hit })
    } else {
      setTooltip(null)
    }
  }

  // 범례: label 기준 유니크 색상
  const legendMap = new Map<string, string>()
  points.forEach(p => {
    if (!legendMap.has(p.label)) {
      legendMap.set(p.label, p.class_colors?.[0] ?? '#6b7280')
    }
  })

  return (
    <div>
      {/* 모델/방식 배지 */}
      <div className="flex gap-2 mb-2">
        <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium">
          {method.toUpperCase()}
        </span>
        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
          {embeddingModel === 'clip' ? 'CLIP ViT-B/32' : embeddingModel === 'histogram' ? 'Color Histogram' : embeddingModel}
        </span>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={720}
          height={420}
          className="w-full rounded-xl border bg-white cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        />

        {/* 이미지 썸네일 툴팁 */}
        {tooltip && (
          <div
            className="absolute z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-2 pointer-events-none"
            style={{
              left: tooltip.x + 16,
              top: Math.max(0, tooltip.y - 80),
              maxWidth: 200,
            }}
          >
            <img
              src={tooltip.point.thumbnail_url}
              alt={tooltip.point.filename}
              className="w-40 h-28 object-contain rounded bg-gray-50 mb-1"
            />
            <p className="text-xs font-medium text-gray-700 truncate">{tooltip.point.filename}</p>
            {tooltip.point.class_names.length > 0 ? (
              <div className="flex flex-wrap gap-1 mt-1">
                {tooltip.point.class_names.map((cn, i) => (
                  <span
                    key={cn}
                    className="text-xs px-1.5 py-0.5 rounded-full text-white font-medium"
                    style={{ background: tooltip.point.class_colors[i] ?? '#6b7280' }}
                  >
                    {cn}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-gray-400 mt-0.5 block">미레이블</span>
            )}
          </div>
        )}
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap gap-3 mt-3">
        {Array.from(legendMap.entries()).map(([label, color]) => (
          <div key={label} className="flex items-center gap-1.5 text-xs text-gray-600">
            <div className="w-3 h-3 rounded-full border border-white shadow-sm" style={{ background: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 이상치 정제 패널 ──────────────────────────────────────────────────
function OutlierPanel({
  datasetId,
  outliers,
  duplicates,
  onDelete,
}: {
  datasetId: number
  outliers: OutlierItem[]
  duplicates: DuplicateCandidate[]
  onDelete: (imageId: number) => void
}) {
  const [tab, setTab] = useState<'outliers' | 'duplicates'>('outliers')
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set())

  const handleDelete = async (imageId: number) => {
    if (deletingIds.has(imageId)) return
    if (!confirm(`이미지 ID ${imageId}를 삭제하시겠습니까? 해당 이미지와 모든 어노테이션이 제거됩니다.`)) return
    setDeletingIds(prev => new Set(prev).add(imageId))
    try {
      await imagesApi.delete(datasetId, imageId)
      onDelete(imageId)
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(imageId); return s })
    }
  }

  return (
    <div className="card p-5 mt-6">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
        <h2 className="font-semibold">이상치 & 중복 정제</h2>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('outliers')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === 'outliers' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          이상치
          <span className="ml-1.5 text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">
            {outliers.length}
          </span>
        </button>
        <button
          onClick={() => setTab('duplicates')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === 'duplicates' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          중복 후보
          <span className="ml-1.5 text-xs bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full">
            {duplicates.length}
          </span>
        </button>
      </div>

      {/* 이상치 탭 */}
      {tab === 'outliers' && (
        <div>
          <p className="text-xs text-gray-400 mb-3">
            임베딩 공간에서 다른 이미지들과 가장 멀리 떨어진 이미지입니다. 오레이블 또는 이질적인 이미지일 수 있습니다.
          </p>
          {outliers.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">이상치가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
              {outliers.map(item => (
                <div key={item.image_id} className="flex gap-3 border rounded-xl p-3 bg-gray-50 hover:bg-white transition-colors">
                  <img
                    src={item.thumbnail_url}
                    alt={item.filename}
                    className="w-20 h-16 object-contain rounded-lg bg-white border flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{item.filename}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      거리 <span className="font-mono text-amber-600">{item.nn_distance.toFixed(3)}</span>
                    </p>
                    {item.class_names.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.class_names.map(cn => (
                          <span key={cn} className="text-xs bg-blue-50 text-blue-600 px-1.5 rounded">{cn}</span>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => handleDelete(item.image_id)}
                      disabled={deletingIds.has(item.image_id)}
                      className="mt-2 flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors"
                    >
                      {deletingIds.has(item.image_id)
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Trash2 className="w-3 h-3" />}
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 중복 후보 탭 */}
      {tab === 'duplicates' && (
        <div>
          <p className="text-xs text-gray-400 mb-3">
            임베딩 거리가 매우 가까운 이미지 쌍입니다. 중복 또는 거의 동일한 이미지일 수 있습니다.
          </p>
          {duplicates.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">중복 후보가 없습니다.</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {duplicates.map((pair, i) => (
                <div key={i} className="border rounded-xl p-3 bg-gray-50 hover:bg-white transition-colors">
                  <div className="flex items-center gap-3">
                    {/* 이미지 A */}
                    <div className="flex-1 text-center">
                      <img
                        src={pair.image_a.thumbnail_url}
                        alt={pair.image_a.filename}
                        className="w-full h-20 object-contain rounded-lg bg-white border mb-1"
                      />
                      <p className="text-xs text-gray-600 truncate">{pair.image_a.filename}</p>
                      <button
                        onClick={() => handleDelete(pair.image_a.image_id)}
                        disabled={deletingIds.has(pair.image_a.image_id)}
                        className="mt-1 flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-40 mx-auto transition-colors"
                      >
                        {deletingIds.has(pair.image_a.image_id)
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Trash2 className="w-3 h-3" />}
                        삭제
                      </button>
                    </div>

                    {/* 거리 배지 */}
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <Copy className="w-4 h-4 text-gray-400" />
                      <span className="text-xs font-mono text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                        d={pair.distance.toFixed(3)}
                      </span>
                    </div>

                    {/* 이미지 B */}
                    <div className="flex-1 text-center">
                      <img
                        src={pair.image_b.thumbnail_url}
                        alt={pair.image_b.filename}
                        className="w-full h-20 object-contain rounded-lg bg-white border mb-1"
                      />
                      <p className="text-xs text-gray-600 truncate">{pair.image_b.filename}</p>
                      <button
                        onClick={() => handleDelete(pair.image_b.image_id)}
                        disabled={deletingIds.has(pair.image_b.image_id)}
                        className="mt-1 flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-40 mx-auto transition-colors"
                      >
                        {deletingIds.has(pair.image_b.image_id)
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Trash2 className="w-3 h-3" />}
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────────────
export default function AnalysisPage() {
  const { selectedDataset, splitRatios, setSplitRatios } = useAppStore()
  const queryClient = useQueryClient()

  // Split 슬라이더
  const [localTrain, setLocalTrain] = useState(splitRatios.train)
  const [localVal, setLocalVal] = useState(splitRatios.val)
  const localTest = Math.max(0, 100 - localTrain - localVal)
  const [saved, setSaved] = useState(false)

  // 임베딩 섹션 상태
  const [showEmbedding, setShowEmbedding] = useState(false)
  const [embMethod, setEmbMethod] = useState<'pca' | 'umap' | 'tsne'>('pca')
  const [showOutliers, setShowOutliers] = useState(false)
  const [outlierTopK, setOutlierTopK] = useState(20)
  const [dupThreshold, setDupThreshold] = useState(0.05)

  // 삭제된 이미지 ID 로컬 추적 (재fetch 전 필터링용)
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set())

  const handleTrainChange = (v: number) => {
    setLocalTrain(Math.max(5, Math.min(v, 100 - localVal - 5)))
  }
  const handleValChange = (v: number) => {
    setLocalVal(Math.max(5, Math.min(v, 100 - localTrain - 5)))
  }
  const handleSave = () => {
    setSplitRatios({ train: localTrain, val: localVal, test: localTest })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // 쿼리들
  const { data: splitStatsData } = useQuery({
    queryKey: ['split-stats', selectedDataset?.id],
    queryFn: () => analysisApi.splitStats(selectedDataset!.id),
    enabled: !!selectedDataset,
  })

  const { data: summary } = useQuery({
    queryKey: ['analysis-summary', selectedDataset?.id],
    queryFn: () => analysisApi.summary(selectedDataset!.id),
    enabled: !!selectedDataset,
  })

  const { data: classDistrib } = useQuery({
    queryKey: ['class-distribution', selectedDataset?.id],
    queryFn: () => analysisApi.classDistribution(selectedDataset!.id),
    enabled: !!selectedDataset,
  })

  const { data: bboxStats } = useQuery({
    queryKey: ['bbox-stats', selectedDataset?.id],
    queryFn: () => analysisApi.bboxStats(selectedDataset!.id),
    enabled: !!selectedDataset,
  })

  const { data: embeddings, isFetching: fetchingEmb, refetch: refetchEmb } = useQuery({
    queryKey: ['embeddings', selectedDataset?.id, embMethod],
    queryFn: () => analysisApi.embeddings(selectedDataset!.id, embMethod),
    enabled: !!selectedDataset && showEmbedding,
    staleTime: 1000 * 60 * 5,
  })

  const { data: outlierData, isFetching: fetchingOutliers, refetch: refetchOutliers } = useQuery({
    queryKey: ['outliers', selectedDataset?.id, outlierTopK, dupThreshold],
    queryFn: () => analysisApi.outliers(selectedDataset!.id, outlierTopK, dupThreshold),
    enabled: !!selectedDataset && showOutliers,
    staleTime: 1000 * 60 * 5,
  })

  // 사전 계산
  const computeMutation = useMutation({
    mutationFn: () => analysisApi.computeEmbeddings(selectedDataset!.id),
    onSuccess: () => {
      // 완료 후 embeddings 쿼리 무효화
      queryClient.invalidateQueries({ queryKey: ['embeddings', selectedDataset?.id] })
      queryClient.invalidateQueries({ queryKey: ['outliers', selectedDataset?.id] })
    },
  })

  // 이미지 삭제 후 처리
  const handleImageDeleted = (imageId: number) => {
    setDeletedIds(prev => new Set(prev).add(imageId))
    queryClient.invalidateQueries({ queryKey: ['analysis-summary', selectedDataset?.id] })
    queryClient.invalidateQueries({ queryKey: ['embeddings', selectedDataset?.id] })
    queryClient.invalidateQueries({ queryKey: ['outliers', selectedDataset?.id] })
  }

  // 삭제된 이미지 필터링
  const visiblePoints = embeddings?.points.filter(p => !deletedIds.has(p.image_id)) ?? []
  const visibleOutliers = outlierData?.outliers.filter(o => !deletedIds.has(o.image_id)) ?? []
  const visibleDuplicates = outlierData?.duplicate_candidates.filter(
    d => !deletedIds.has(d.image_a.image_id) && !deletedIds.has(d.image_b.image_id)
  ) ?? []

  if (!selectedDataset) {
    return <div className="card p-8 text-center text-gray-500">홈 화면에서 데이터셋을 선택하세요.</div>
  }

  return (
    <div>
      <h1 className="page-header">데이터셋 분석</h1>
      <p className="page-subtitle">클래스 분포, 바운딩 박스 통계, 임베딩 시각화를 제공합니다.</p>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-5 gap-4 mb-6">
          <StatCard label="이미지" value={summary.image_count} />
          <StatCard label="주석" value={summary.annotation_count} />
          <StatCard label="클래스" value={summary.class_count} />
          <StatCard label="미레이블" value={summary.unlabeled_count} />
          <StatCard label="평균 주석/이미지" value={summary.avg_annotations_per_image} />
        </div>
      )}

      {/* 클래스 분포 차트 */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {classDistrib && classDistrib.length > 0 && (
          <div className="card p-5">
            <h2 className="font-semibold mb-4">클래스 분포</h2>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={classDistrib}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {classDistrib.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {classDistrib && classDistrib.length > 0 && (
          <div className="card p-5">
            <h2 className="font-semibold mb-4">클래스별 주석 수</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={classDistrib} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" name="주석 수">
                  {classDistrib.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Split Balance */}
      <div className="card p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Sliders className="w-4 h-4 text-blue-500" />
          <h2 className="font-semibold">Split Balance</h2>
          <span className="text-xs text-gray-400 ml-1">(applies to images without a split label)</span>
        </div>

        {splitStatsData && splitStatsData.total > 0 && (
          <div className="mb-5">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Current split status</span>
              <span className="text-gray-400">{splitStatsData.total} images total</span>
            </div>
            <div className="flex h-5 rounded-full overflow-hidden w-full">
              {[
                { key: 'train', color: '#3B82F6' },
                { key: 'val', color: '#F59E0B' },
                { key: 'test', color: '#10B981' },
                { key: 'unsplit', color: '#E5E7EB' },
              ].map(({ key, color }) => {
                const count = splitStatsData[key as keyof typeof splitStatsData] as number
                const pct = (count / splitStatsData.total) * 100
                return pct > 0 ? (
                  <div key={key} style={{ width: `${pct}%`, background: color }} />
                ) : null
              })}
            </div>
            <div className="flex flex-wrap gap-3 mt-2">
              {[
                { key: 'train', color: '#3B82F6', label: 'Train' },
                { key: 'val', color: '#F59E0B', label: 'Val' },
                { key: 'test', color: '#10B981', label: 'Test' },
                { key: 'unsplit', color: '#E5E7EB', label: 'Unsplit', text: '#6B7280' },
              ].map(({ key, color, label, text }) => {
                const count = splitStatsData[key as keyof typeof splitStatsData] as number
                return count > 0 ? (
                  <div key={key} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <div className="w-3 h-3 rounded-sm border border-gray-200" style={{ background: color }} />
                    <span style={{ color: text }}>{label}</span>
                    <span className="font-medium" style={{ color: text }}>{count}</span>
                  </div>
                ) : null
              })}
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium text-blue-600">Train</span>
              <span className="font-bold text-blue-600">{localTrain}%</span>
            </div>
            <input type="range" min={5} max={90} step={1} value={localTrain}
              onChange={e => handleTrainChange(Number(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              style={{ accentColor: '#3B82F6' }} />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium text-amber-500">Val</span>
              <span className="font-bold text-amber-500">{localVal}%</span>
            </div>
            <input type="range" min={5} max={Math.max(5, 95 - localTrain)} step={1} value={localVal}
              onChange={e => handleValChange(Number(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              style={{ accentColor: '#F59E0B' }} />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium text-emerald-500">Test</span>
              <span className="font-bold text-emerald-500">{localTest}%</span>
            </div>
            <div className="w-full h-2 rounded-lg bg-gray-100">
              <div className="h-2 rounded-lg" style={{ width: `${localTest}%`, background: '#10B981' }} />
            </div>
            <p className="text-xs text-gray-400 mt-0.5">Auto-computed: 100 - Train - Val</p>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-xs text-gray-500 mb-1">Preview (unsplit images will be distributed as:)</p>
          <div className="flex h-6 rounded-lg overflow-hidden w-full text-xs font-semibold">
            <div className="flex items-center justify-center text-white"
              style={{ width: `${localTrain}%`, background: '#3B82F6' }}>
              {localTrain >= 10 ? `${localTrain}%` : ''}
            </div>
            <div className="flex items-center justify-center text-white"
              style={{ width: `${localVal}%`, background: '#F59E0B' }}>
              {localVal >= 10 ? `${localVal}%` : ''}
            </div>
            <div className="flex items-center justify-center text-white"
              style={{ width: `${localTest}%`, background: '#10B981' }}>
              {localTest >= 10 ? `${localTest}%` : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors font-medium">
            Save ratios
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle2 className="w-4 h-4" /> Saved
            </span>
          )}
        </div>
      </div>

      {/* BBox 통계 */}
      {bboxStats && bboxStats.count > 0 && (
        <div className="card p-5 mb-6">
          <h2 className="font-semibold mb-4">바운딩 박스 통계</h2>
          <div className="grid grid-cols-3 gap-4 text-sm mb-4">
            {(['width_stats', 'height_stats', 'area_stats'] as const).map(k => (
              <div key={k} className="bg-gray-50 rounded-lg p-3">
                <div className="font-medium mb-2 text-gray-700">
                  {k === 'width_stats' ? '너비' : k === 'height_stats' ? '높이' : '면적'}
                </div>
                {Object.entries(bboxStats[k]).map(([stat, val]) => (
                  <div key={stat} className="flex justify-between text-xs text-gray-500">
                    <span>{stat}</span>
                    <span className="font-medium text-gray-700">{String(val)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">총 {bboxStats.count}개 바운딩 박스</p>
        </div>
      )}

      {/* 임베딩 시각화 */}
      <div className="card p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-semibold">이미지 임베딩 시각화</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              CLIP 픽셀 임베딩 기반 2D 투영 · 이미지 클러스터 탐색
            </p>
          </div>
          <div className="flex gap-2">
            {/* 사전 계산 버튼 */}
            <button
              onClick={() => computeMutation.mutate()}
              disabled={computeMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {computeMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              사전 계산
            </button>
            {!showEmbedding && (
              <button
                onClick={() => setShowEmbedding(true)}
                className="px-4 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors font-medium"
              >
                시각화 생성
              </button>
            )}
          </div>
        </div>

        {computeMutation.isSuccess && (
          <div className="mb-3 text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2">
            사전 계산 완료. 새로 시각화를 생성하면 업데이트된 임베딩이 적용됩니다.
          </div>
        )}

        {showEmbedding && (
          <>
            {/* 방식 선택 탭 */}
            <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
              {(['pca', 'umap', 'tsne'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setEmbMethod(m)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors uppercase ${
                    embMethod === m ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {fetchingEmb && (
              <div className="flex items-center justify-center gap-2 py-12 text-gray-400 text-sm">
                <Loader2 className="w-5 h-5 animate-spin" />
                {embMethod === 'umap' ? 'UMAP 계산 중 (수십 초 소요)…' : `${embMethod.toUpperCase()} 계산 중…`}
              </div>
            )}
            {!fetchingEmb && embeddings?.note && (
              <p className="text-sm text-gray-400 text-center py-8">{embeddings.note}</p>
            )}
            {!fetchingEmb && embeddings && visiblePoints.length > 0 && (
              <>
                <EmbeddingScatter
                  points={visiblePoints}
                  method={embeddings.method}
                  embeddingModel={embeddings.embedding_model}
                />
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-gray-400">
                    총 {visiblePoints.length}개 이미지
                  </p>
                  <button
                    onClick={() => refetchEmb()}
                    className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> 새로고침
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {!showEmbedding && (
          <p className="text-sm text-gray-400">
            버튼을 클릭하면 CLIP 임베딩을 2D로 압축하여 이미지 클러스터를 시각화합니다.
            이미지에 마우스를 올리면 썸네일과 클래스 정보를 확인할 수 있습니다.
          </p>
        )}
      </div>

      {/* 이상치 정제 패널 */}
      {showEmbedding && embeddings && visiblePoints.length > 0 && (
        <div className="mt-4">
          {!showOutliers ? (
            <button
              onClick={() => setShowOutliers(true)}
              className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-amber-300 hover:text-amber-600 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              이상치 & 중복 탐지 열기
            </button>
          ) : (
            <>
              {/* 파라미터 조정 */}
              <div className="card p-4 mb-2">
                <div className="flex items-center gap-6 flex-wrap">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 whitespace-nowrap">이상치 상위</label>
                    <input
                      type="number" min={5} max={200} value={outlierTopK}
                      onChange={e => setOutlierTopK(Number(e.target.value))}
                      className="w-16 text-xs border rounded px-2 py-1"
                    />
                    <span className="text-xs text-gray-400">개</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 whitespace-nowrap">중복 임계값</label>
                    <input
                      type="number" min={0.01} max={0.5} step={0.01} value={dupThreshold}
                      onChange={e => setDupThreshold(Number(e.target.value))}
                      className="w-20 text-xs border rounded px-2 py-1"
                    />
                    <span className="text-xs text-gray-400">(코사인 거리)</span>
                  </div>
                  <button
                    onClick={() => refetchOutliers()}
                    disabled={fetchingOutliers}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
                  >
                    {fetchingOutliers ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    분석
                  </button>
                </div>
              </div>

              {fetchingOutliers && (
                <div className="flex items-center justify-center gap-2 py-6 text-gray-400 text-sm card">
                  <Loader2 className="w-5 h-5 animate-spin" /> 이상치 분석 중…
                </div>
              )}
              {!fetchingOutliers && outlierData && (
                <OutlierPanel
                  datasetId={selectedDataset.id}
                  outliers={visibleOutliers}
                  duplicates={visibleDuplicates}
                  onDelete={handleImageDeleted}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
