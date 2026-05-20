import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useAppStore } from '../store'
import { analysisApi, type EmbeddingPoint } from '../api/analysis'

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4 text-center">
      <div className="text-2xl font-bold text-blue-600">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

// ── 임베딩 산점도 (Canvas 직접 그리기) ───────────────────────────────
function EmbeddingScatter({ points }: { points: EmbeddingPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || points.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    const PAD = 32

    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    const xMin = Math.min(...xs), xMax = Math.max(...xs)
    const yMin = Math.min(...ys), yMax = Math.max(...ys)
    const xRange = xMax - xMin || 1
    const yRange = yMax - yMin || 1

    const toCanvasX = (v: number) => PAD + ((v - xMin) / xRange) * (W - PAD * 2)
    const toCanvasY = (v: number) => H - PAD - ((v - yMin) / yRange) * (H - PAD * 2)

    ctx.clearRect(0, 0, W, H)

    // 그리드
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const gx = PAD + (i / 4) * (W - PAD * 2)
      const gy = PAD + (i / 4) * (H - PAD * 2)
      ctx.beginPath(); ctx.moveTo(gx, PAD); ctx.lineTo(gx, H - PAD); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(PAD, gy); ctx.lineTo(W - PAD, gy); ctx.stroke()
    }

    // 포인트
    points.forEach(p => {
      ctx.beginPath()
      ctx.arc(toCanvasX(p.x), toCanvasY(p.y), 4, 0, Math.PI * 2)
      ctx.fillStyle = p.class_color + 'cc'
      ctx.fill()
      ctx.strokeStyle = p.class_color
      ctx.lineWidth = 0.8
      ctx.stroke()
    })
  }, [points])

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || points.length === 0) return
    const rect = canvas.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width)
    const my = (e.clientY - rect.top) * (canvas.height / rect.height)

    const PAD = 32
    const W = canvas.width, H = canvas.height
    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    const xMin = Math.min(...xs), xMax = Math.max(...xs)
    const yMin = Math.min(...ys), yMax = Math.max(...ys)
    const xRange = xMax - xMin || 1
    const yRange = yMax - yMin || 1
    const toCanvasX = (v: number) => PAD + ((v - xMin) / xRange) * (W - PAD * 2)
    const toCanvasY = (v: number) => H - PAD - ((v - yMin) / yRange) * (H - PAD * 2)

    const hit = points.find(p => {
      const dx = toCanvasX(p.x) - mx
      const dy = toCanvasY(p.y) - my
      return Math.sqrt(dx * dx + dy * dy) < 7
    })

    if (hit) {
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, label: hit.class_name })
    } else {
      setTooltip(null)
    }
  }

  // 범례
  const classMap = new Map<string, string>()
  points.forEach(p => classMap.set(p.class_name, p.class_color))

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={700}
        height={380}
        className="w-full rounded-lg border bg-gray-50 cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      />
      {tooltip && (
        <div
          className="absolute bg-gray-800 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap z-10"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          {tooltip.label}
        </div>
      )}
      {/* 범례 */}
      <div className="flex flex-wrap gap-3 mt-3">
        {Array.from(classMap.entries()).map(([name, color]) => (
          <div key={name} className="flex items-center gap-1.5 text-xs text-gray-600">
            <div className="w-3 h-3 rounded-full border" style={{ background: color }} />
            {name}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────────────
export default function AnalysisPage() {
  const { selectedDataset } = useAppStore()
  const [showEmbedding, setShowEmbedding] = useState(false)

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

  const { data: embeddings, isFetching: fetchingEmb } = useQuery({
    queryKey: ['embeddings', selectedDataset?.id],
    queryFn: () => analysisApi.embeddings(selectedDataset!.id),
    enabled: !!selectedDataset && showEmbedding,
  })

  if (!selectedDataset) {
    return <div className="card p-8 text-center text-gray-500">홈 화면에서 데이터셋을 선택하세요.</div>
  }

  return (
    <div>
      <h1 className="page-header">📊 데이터셋 분석</h1>
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

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* 파이 차트 */}
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

        {/* 막대 차트 */}
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

      {/* BBox 통계 */}
      {bboxStats && bboxStats.count > 0 && (
        <div className="card p-5 mb-6">
          <h2 className="font-semibold mb-4">바운딩 박스 통계</h2>
          <div className="grid grid-cols-3 gap-4 text-sm mb-4">
            {(['width_stats', 'height_stats', 'area_stats'] as const).map(k => (
              <div key={k} className="bg-gray-50 rounded-lg p-3">
                <div className="font-medium mb-2 text-gray-700">
                  {k === 'width_stats' ? '너비(px)' : k === 'height_stats' ? '높이(px)' : '면적(px²)'}
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold">어노테이션 임베딩 시각화</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              bbox 피처(cx, cy, w, h) → PCA 2D 투영 · 클래스별 색상
            </p>
          </div>
          {!showEmbedding && (
            <button
              onClick={() => setShowEmbedding(true)}
              className="px-4 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors font-medium"
            >
              시각화 생성
            </button>
          )}
        </div>

        {showEmbedding && (
          <>
            {fetchingEmb && (
              <div className="text-center py-10 text-gray-400 text-sm">PCA 계산 중…</div>
            )}
            {embeddings?.note && (
              <p className="text-sm text-gray-400 text-center py-8">{embeddings.note}</p>
            )}
            {embeddings && embeddings.points.length > 0 && (
              <>
                <EmbeddingScatter points={embeddings.points} />
                <p className="text-xs text-gray-400 mt-2 text-right">
                  총 {embeddings.total}개 어노테이션
                </p>
              </>
            )}
          </>
        )}

        {!showEmbedding && (
          <p className="text-sm text-gray-400">
            버튼을 클릭하면 bbox 피처를 PCA로 압축하여 2D 산점도를 생성합니다.
          </p>
        )}
      </div>
    </div>
  )
}
