import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import ReactFlow, {
  Controls,
  Background,
  MiniMap,
  Node,
  Edge,
  Handle,
  Position,
  MarkerType
} from 'reactflow'
import 'reactflow/dist/style.css'
import { versionsApi } from '../api/versions'
import { useAppStore } from '../store'
import type { DatasetVersion, LineageNode, LineageEdge } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

function VersionBadge({ branch }: { branch: string }) {
  const color =
    branch === 'main'
      ? 'bg-blue-100 text-blue-700'
      : branch === 'dev'
      ? 'bg-green-100 text-green-700'
      : 'bg-purple-100 text-purple-700'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {branch}
    </span>
  )
}

function DiffChip({ label, value, color }: { label: string; value: number; color: string }) {
  if (value === 0) return null
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      {label} {value}
    </span>
  )
}

function VersionCard({
  ver,
  onDelete,
  onRollback,
}: {
  ver: DatasetVersion
  onDelete: (id: number) => void
  onRollback: (ver: DatasetVersion) => void
}) {
  const [open, setOpen] = useState(false)
  const date = new Date(ver.created_at).toLocaleString('ko-KR')

  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm hover:shadow transition-shadow">
      <div
        className="flex items-center justify-between p-4 cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <div className="text-lg font-semibold text-gray-800">{ver.version_name}</div>
          <VersionBadge branch={ver.branch_name} />
          {ver.tags &&
            ver.tags.split(',').map(t => (
              <span
                key={t}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600"
              >
                {t.trim()}
              </span>
            ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <DiffChip label="➕" value={ver.added_images} color="text-green-600" />
            <DiffChip label="➖" value={ver.deleted_images} color="text-red-500" />
            <DiffChip label="✏️" value={ver.modified_labels} color="text-yellow-600" />
          </div>
          <span className="text-xs text-gray-400">{date}</span>
          <div className="flex items-center gap-2">
            {ver.has_snapshot && (
              <button
                onClick={e => {
                  e.stopPropagation()
                  onRollback(ver)
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 transition-colors"
                title="이 버전으로 롤백"
              >
                ↩ 롤백
              </button>
            )}
            <button
              onClick={e => {
                e.stopPropagation()
                onDelete(ver.id)
              }}
              className="text-gray-300 hover:text-red-400 transition-colors text-sm"
              title="버전 삭제"
            >
              ✕
            </button>
          </div>
          <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div className="border-t border-gray-100 p-4 space-y-3">
          {ver.description && (
            <p className="text-sm text-gray-600">{ver.description}</p>
          )}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="bg-gray-50 rounded p-3 text-center">
              <div className="text-xl font-bold text-blue-600">{ver.image_count.toLocaleString()}</div>
              <div className="text-gray-500 mt-1">이미지</div>
            </div>
            <div className="bg-gray-50 rounded p-3 text-center">
              <div className="text-xl font-bold text-indigo-600">{ver.annotation_count.toLocaleString()}</div>
              <div className="text-gray-500 mt-1">어노테이션</div>
            </div>
            <div className="bg-gray-50 rounded p-3 text-center">
              <div className="text-xl font-bold text-purple-600">{ver.class_count}</div>
              <div className="text-gray-500 mt-1">클래스</div>
            </div>
          </div>

          {ver.class_distribution.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-2">클래스 분포</div>
              <div className="flex flex-wrap gap-2">
                {ver.class_distribution.slice(0, 12).map(c => (
                  <span
                    key={c.name}
                    className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded"
                  >
                    {c.name}: {c.count}
                  </span>
                ))}
                {ver.class_distribution.length > 12 && (
                  <span className="text-xs text-gray-400">+{ver.class_distribution.length - 12}개 더</span>
                )}
              </div>
            </div>
          )}

          <div className="text-xs text-gray-400 flex items-center gap-4">
            <span>생성자: {ver.created_by}</span>
            {ver.parent_version_id && <span>부모 버전 ID: {ver.parent_version_id}</span>}
            <span className="font-mono">Hash: {ver.image_ids_hash.slice(0, 8)}…</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 리니지 그래프 (React Flow 기반)
// ─────────────────────────────────────────────────────────────────────────────

function DatasetVersionNode({ data }: { data: any }) {
  return (
    <div className="bg-blue-50 border-2 border-blue-500 rounded-lg p-3 w-48 shadow-sm hover:shadow-md transition-shadow">
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-blue-500" />
      <div className="text-sm font-bold text-blue-700 text-center truncate" title={data.label}>
        {data.label}
      </div>
      <div className="text-xs text-blue-400 text-center mt-1">
        {new Date(data.created_at).toLocaleDateString('ko-KR')}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-blue-500" />
    </div>
  )
}

function ModelVersionNode({ data }: { data: any }) {
  return (
    <div className="bg-green-50 border-2 border-green-500 rounded-lg p-3 w-48 shadow-sm hover:shadow-md transition-shadow">
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-green-500" />
      <div className="text-sm font-bold text-green-700 text-center truncate" title={data.label}>
        {data.label}
      </div>
      <div className="text-xs text-green-500 text-center mt-1">
        {new Date(data.created_at).toLocaleDateString('ko-KR')}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-green-500" />
    </div>
  )
}

const nodeTypes = {
  dataset_version: DatasetVersionNode,
  model_version: ModelVersionNode,
}

function LineageGraphView({ datasetId }: { datasetId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['lineage', datasetId],
    queryFn: () => versionsApi.getLineage(datasetId),
  })

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [], edges: [] }

    const dvNodes = data.nodes.filter(n => n.type === 'dataset_version')
    const mvNodes = data.nodes.filter(n => n.type === 'model_version')

    const rfNodes: Node[] = []
    const rfEdges: Edge[] = []

    // 간단한 레이아웃: 데이터셋 버전은 왼쪽 열, 모델 버전은 오른쪽 열
    dvNodes.forEach((n, i) => {
      rfNodes.push({
        id: String(n.id),
        type: 'dataset_version',
        position: { x: 50, y: 50 + i * 120 },
        data: { label: n.label, created_at: n.created_at },
      })
    })

    mvNodes.forEach((n, i) => {
      rfNodes.push({
        id: String(n.id),
        type: 'model_version',
        position: { x: 350, y: 50 + i * 120 },
        data: { label: n.label, created_at: n.created_at },
      })
    })

    data.edges.forEach((e, i) => {
      rfEdges.push({
        id: `e-${e.source}-${e.target}-${i}`,
        source: String(e.source),
        target: String(e.target),
        label: e.label,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#94a3b8', strokeWidth: 2 },
        labelStyle: { fill: '#64748b', fontSize: 11, fontWeight: 500 },
        labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.9 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#94a3b8',
        },
      })
    })

    return { nodes: rfNodes, edges: rfEdges }
  }, [data])

  if (isLoading) return <div className="text-center py-12 text-gray-400">리니지 로딩 중…</div>
  if (error || !data) return <div className="text-center py-12 text-red-400">리니지 로드 실패</div>
  if (data.nodes.length === 0)
    return <div className="text-center py-12 text-gray-400">버전이 없습니다. 첫 스냅샷을 찍어보세요.</div>

  return (
    <div className="w-full h-[600px] border border-gray-200 rounded-xl bg-gray-50 shadow-inner overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="#cbd5e1" gap={16} />
        <Controls className="bg-white shadow-md rounded-lg" />
        <MiniMap zoomable pannable className="rounded-lg shadow-md border border-gray-200" />
      </ReactFlow>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 버전 생성 모달
// ─────────────────────────────────────────────────────────────────────────────

function CreateVersionModal({
  datasetId,
  versions,
  onClose,
}: {
  datasetId: number
  versions: DatasetVersion[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    version_name: '',
    description: '',
    branch_name: 'main',
    tags: '',
    parent_version_id: '' as string | number,
    created_by: 'user',
  })

  const mut = useMutation({
    mutationFn: () =>
      versionsApi.create(datasetId, {
        ...form,
        parent_version_id: form.parent_version_id ? Number(form.parent_version_id) : null,
      }),
    onSuccess: () => {
      toast.success('버전이 생성되었습니다.')
      qc.invalidateQueries({ queryKey: ['versions', datasetId] })
      qc.invalidateQueries({ queryKey: ['lineage', datasetId] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const field = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-800">새 버전 스냅샷 생성</h2>
        <p className="text-sm text-gray-500">현재 데이터셋 상태를 스냅샷으로 저장합니다.</p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">버전 이름 *</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="예: v1.0.0"
              value={form.version_name}
              onChange={e => field('version_name', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">브랜치</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="main"
              value={form.branch_name}
              onChange={e => field('branch_name', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              rows={3}
              placeholder="이 버전에 대한 설명"
              value={form.description}
              onChange={e => field('description', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">태그 (쉼표 구분)</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="학습용, 검증용"
              value={form.tags}
              onChange={e => field('tags', e.target.value)}
            />
          </div>
          {versions.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">부모 버전 (선택)</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={form.parent_version_id}
                onChange={e => field('parent_version_id', e.target.value)}
              >
                <option value="">없음 (루트 버전)</option>
                {versions.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.version_name} [{v.branch_name}]
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">생성자</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={form.created_by}
              onChange={e => field('created_by', e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={!form.version_name.trim() || mut.isPending}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {mut.isPending ? '생성 중…' : '스냅샷 생성'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 롤백 확인 모달
// ─────────────────────────────────────────────────────────────────────────────

function RollbackModal({
  ver,
  datasetId,
  onClose,
}: {
  ver: DatasetVersion
  datasetId: number
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [result, setResult] = useState<{
    restored_images: number
    restored_annotations: number
    missing_physical_files: string[]
  } | null>(null)

  const rollbackMut = useMutation({
    mutationFn: () => versionsApi.rollback(datasetId, ver.id),
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['versions', datasetId] })
      if (data.missing_physical_files.length === 0) {
        toast.success(`"${ver.version_name}"으로 완전 복구되었습니다.`)
      } else {
        toast(`복구 완료 (${data.missing_physical_files.length}개 파일 누락)`, { icon: '⚠️' })
      }
    },
    onError: (e: Error) => toast.error(`롤백 실패: ${e.message}`),
  })

  if (result) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
          <div className="text-center">
            <div className="text-3xl mb-2">{result.missing_physical_files.length === 0 ? '✅' : '⚠️'}</div>
            <h2 className="text-lg font-bold text-gray-800">롤백 완료</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-blue-600">{result.restored_images}</div>
              <div className="text-gray-500 mt-0.5">이미지 복구</div>
            </div>
            <div className="bg-indigo-50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-indigo-600">{result.restored_annotations}</div>
              <div className="text-gray-500 mt-0.5">라벨 복구</div>
            </div>
          </div>
          {result.missing_physical_files.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-medium text-amber-700 mb-1">⚠️ 물리 파일 없음 ({result.missing_physical_files.length}개)</p>
              <div className="max-h-24 overflow-y-auto">
                {result.missing_physical_files.map(f => (
                  <div key={f} className="text-xs text-amber-600 font-mono truncate">{f}</div>
                ))}
              </div>
            </div>
          )}
          <button onClick={onClose} className="w-full py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors">
            닫기
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <div className="text-center">
          <div className="text-4xl mb-2">↩</div>
          <h2 className="text-lg font-bold text-gray-800">버전 롤백 확인</h2>
          <p className="text-sm text-gray-500 mt-1">
            <span className="font-semibold text-gray-700">"{ver.version_name}"</span> 버전으로 되돌립니다.
          </p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700 space-y-1">
          <p className="font-semibold">⚠️ 주의사항</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs">
            <li>현재 데이터셋의 모든 이미지와 라벨이 해당 버전 상태로 교체됩니다.</li>
            <li>물리 파일(이미지 원본)은 보존되어 있어 완전 복구가 가능합니다.</li>
            <li>이 작업 후 현재 변경사항은 되돌릴 수 없습니다.</li>
          </ul>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
          <span className="font-medium">복구 대상:</span> 이미지 {ver.image_count}장 / 어노테이션 {ver.annotation_count}개 / 클래스 {ver.class_count}종
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors">
            취소
          </button>
          <button
            onClick={() => rollbackMut.mutate()}
            disabled={rollbackMut.isPending}
            className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {rollbackMut.isPending ? '복구 중…' : '롤백 실행'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 Versioning 페이지
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'versions' | 'lineage'

export default function Versioning() {
  const { selectedDataset } = useAppStore()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('versions')
  const [showCreate, setShowCreate] = useState(false)
  const [branchFilter, setBranchFilter] = useState('')
  const [rollbackTarget, setRollbackTarget] = useState<DatasetVersion | null>(null)

  const datasetId = selectedDataset?.id ?? 0

  const { data, isLoading } = useQuery({
    queryKey: ['versions', datasetId, branchFilter],
    queryFn: () => versionsApi.list(datasetId, branchFilter || undefined),
    enabled: datasetId > 0,
  })

  const deleteMut = useMutation({
    mutationFn: (versionId: number) => versionsApi.delete(datasetId, versionId),
    onSuccess: () => {
      toast.success('버전이 삭제되었습니다.')
      qc.invalidateQueries({ queryKey: ['versions', datasetId] })
      qc.invalidateQueries({ queryKey: ['lineage', datasetId] })
    },
    onError: () => toast.error('삭제 실패'),
  })

  const gcMut = useMutation({
    mutationFn: () => versionsApi.gc(datasetId),
    onSuccess: (data) => {
      if (data.deleted_count === 0) {
        toast.success('정리할 고아 파일이 없습니다.')
      } else {
        toast.success(`${data.deleted_count}개 파일 삭제 완료 (${data.freed_mb} MB 확보)`)
      }
    },
    onError: () => toast.error('GC 실패'),
  })

  if (!selectedDataset) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        좌측에서 데이터셋을 선택하세요.
      </div>
    )
  }

  const versions = data?.items ?? []
  const total = data?.total ?? 0

  // 브랜치 목록 추출
  const branches = [...new Set(versions.map(v => v.branch_name))]

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">버저닝 & 리니지</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {selectedDataset.name} — 데이터셋 버전 관리 및 모델 연결 추적
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (window.confirm('DB에 없는 고아 파일을 삭제합니다. 계속할까요?')) {
                gcMut.mutate()
              }
            }}
            disabled={gcMut.isPending}
            className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            title="uploads 폴더의 고아 파일 일괄 삭제"
          >
            {gcMut.isPending ? '정리 중…' : '🗑️ 파일 정리 (GC)'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            + 스냅샷 생성
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="flex gap-6">
          {(['versions', 'lineage'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'versions' ? '버전 목록' : '리니지 그래프'}
            </button>
          ))}
        </div>
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'versions' && (
          <div className="space-y-4 max-w-4xl mx-auto">
            {/* 필터 */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">브랜치:</span>
              <button
                onClick={() => setBranchFilter('')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  !branchFilter
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                전체
              </button>
              {branches.map(b => (
                <button
                  key={b}
                  onClick={() => setBranchFilter(b)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    branchFilter === b
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {b}
                </button>
              ))}
              <span className="ml-auto text-xs text-gray-400">총 {total}개</span>
            </div>

            {isLoading && (
              <div className="text-center py-12 text-gray-400">버전 로딩 중…</div>
            )}

            {!isLoading && versions.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <div className="text-4xl mb-3">📋</div>
                <div className="text-sm">아직 버전이 없습니다.</div>
                <div className="text-xs mt-1">
                  우측 상단의 "스냅샷 생성" 버튼으로 첫 버전을 만들어보세요.
                </div>
              </div>
            )}

            {versions.map(v => (
              <VersionCard
                key={v.id}
                ver={v}
                onDelete={id => {
                  if (window.confirm(`버전 "${v.version_name}"을 삭제하시겠습니까?`))
                    deleteMut.mutate(id)
                }}
                onRollback={ver => setRollbackTarget(ver)}
              />
            ))}
          </div>
        )}

        {tab === 'lineage' && (
          <div className="max-w-4xl mx-auto space-y-4">
            <p className="text-sm text-gray-500">
              데이터셋 버전(파란색)과 연결된 모델 버전(초록색)을 시각화합니다.
            </p>
            <LineageGraphView datasetId={datasetId} />
          </div>
        )}
      </div>

      {/* 버전 생성 모달 */}
      {showCreate && (
        <CreateVersionModal
          datasetId={datasetId}
          versions={versions}
          onClose={() => setShowCreate(false)}
        />
      )}

      {rollbackTarget && (
        <RollbackModal
          ver={rollbackTarget}
          datasetId={datasetId}
          onClose={() => setRollbackTarget(null)}
        />
      )}
    </div>
  )
}
