import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bot, Play, Trash2, X, CheckCircle, AlertCircle,
  Clock, Loader2, Upload, Server,
} from 'lucide-react'
import { autoLabelApi } from '../api/autoLabel'
import type { AutoLabelRun } from '../api/autoLabel'
import { onnxModelsApi } from '../api/onnxModels'
import type { OnnxModel } from '../api/onnxModels'
import { useAppStore } from '../store'
import { imagesApi } from '../api/images'

// ── 상수 ──────────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="w-4 h-4 text-yellow-500" />,
  running: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  completed: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <AlertCircle className="w-4 h-4 text-red-500" />,
}

const STATUS_LABELS: Record<string, string> = {
  pending: '대기 중', running: '실행 중', completed: '완료', failed: '실패',
}

const ARCH_OPTIONS = [
  { value: 'rfdetr', label: 'RF-DETR' },
  { value: 'deimv2', label: 'DEIMv2' },
]

// ── 헬퍼 ──────────────────────────────────────────────────────────────────

function parseTextPrompts(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as string[]
  } catch {
    return [raw]
  }
  return []
}

function fmtBytes(n: number | null): string {
  if (!n) return ''
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${(n / 1024).toFixed(0)} KB`
}

// ── 태그 입력 공용 컴포넌트 ───────────────────────────────────────────────

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

function TagInput({ tags, onChange, placeholder }: TagInputProps) {
  const [input, setInput] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  const add = (v: string) => {
    const t = v.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setInput('')
  }
  const remove = (t: string) => onChange(tags.filter(x => x !== t))
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input) }
    else if (e.key === 'Backspace' && input === '' && tags.length > 0) onChange(tags.slice(0, -1))
  }

  return (
    <div
      className="flex flex-wrap gap-2 p-2 border border-gray-300 rounded-lg min-h-[44px] cursor-text
                 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 bg-white"
      onClick={() => ref.current?.focus()}
    >
      {tags.map(t => (
        <span key={t} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-md">
          {t}
          <button type="button" onClick={e => { e.stopPropagation(); remove(t) }} className="hover:text-blue-600">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => { if (input.trim()) add(input) }}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[140px] outline-none text-sm bg-transparent"
      />
    </div>
  )
}

// ── ONNX 업로드 모달 ──────────────────────────────────────────────────────

interface UploadModalProps {
  onClose: () => void
  onUploaded: () => void
}

function OnnxUploadModal({ onClose, onUploaded }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [arch, setArch] = useState('yolov8')
  const [labels, setLabels] = useState<string[]>([])
  const [inputW, setInputW] = useState(384)
  const [inputH, setInputH] = useState(384)
  const [conf, setConf] = useState(0.25)
  const [iou, setIou] = useState(0.45)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const uploadMut = useMutation({
    mutationFn: () =>
      onnxModelsApi.upload(
        file!,
        {
          name: name || file!.name,
          architecture: arch,
          class_labels: labels,
          input_width: inputW,
          input_height: inputH,
          conf_threshold: conf,
          iou_threshold: iou,
        },
        pct => setProgress(pct),
      ),
    onSuccess: () => { onUploaded(); onClose() },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-800">ONNX 모델 업로드</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 파일 선택 */}
        <div className="mb-4">
          <label className="form-label block mb-1">ONNX 파일</label>
          <label className="flex items-center gap-3 p-3 border-2 border-dashed border-gray-300
                            rounded-lg cursor-pointer hover:border-blue-400 transition-colors">
            <Upload className="w-5 h-5 text-gray-400 shrink-0" />
            <span className="text-sm text-gray-500 truncate">
              {file ? file.name : '.onnx 파일을 선택하세요'}
            </span>
            <input
              type="file"
              accept=".onnx"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0] ?? null
                setFile(f)
                if (f && !name) setName(f.name.replace('.onnx', ''))
              }}
            />
          </label>
        </div>

        {/* 모델명 */}
        <div className="mb-4">
          <label className="form-label block mb-1">모델 이름</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="예: 화재감지 v1"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* 아키텍처 */}
        <div className="mb-4">
          <label className="form-label block mb-1">아키텍처</label>
          <select
            value={arch}
            onChange={e => setArch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
          >
            {ARCH_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* 클래스 레이블 */}
        <div className="mb-4">
          <label className="form-label block mb-1">
            클래스 레이블
            <span className="text-gray-400 font-normal ml-1">Enter로 추가 · 순서 = class_id</span>
          </label>
          <TagInput tags={labels} onChange={setLabels} placeholder="예: fire, smoke, flood ..." />
          {labels.length === 0 && (
            <p className="text-xs text-red-500 mt-1">클래스 레이블을 하나 이상 입력해주세요.</p>
          )}
        </div>

        {/* 입력 해상도 */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="form-label block mb-1">입력 너비</label>
            <input type="number" value={inputW} min={32} step={32}
              onChange={e => setInputW(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label className="form-label block mb-1">입력 높이</label>
            <input type="number" value={inputH} min={32} step={32}
              onChange={e => setInputH(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
        </div>

        {/* Threshold */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div>
            <label className="form-label block mb-1">Conf 기본값: {conf.toFixed(2)}</label>
            <input type="range" min={0.01} max={0.99} step={0.01}
              value={conf} onChange={e => setConf(Number(e.target.value))} className="w-full" />
          </div>
          <div>
            <label className="form-label block mb-1">IoU 기본값: {iou.toFixed(2)}</label>
            <input type="range" min={0.01} max={0.99} step={0.01}
              value={iou} onChange={e => setIou(Number(e.target.value))} className="w-full" />
          </div>
        </div>

        {/* 업로드 진행 */}
        {uploadMut.isPending && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>업로드 중...</span><span>{progress}%</span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 p-2 rounded mb-4">{error}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            취소
          </button>
          <button
            onClick={() => uploadMut.mutate()}
            disabled={!file || labels.length === 0 || uploadMut.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg
                       hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed
                       flex items-center gap-2"
          >
            {uploadMut.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" />업로드 중</>
              : <><Upload className="w-4 h-4" />업로드</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────

export default function AutoLabel() {
  const { selectedDataset } = useAppStore()
  const qc = useQueryClient()

  // ── 공통 상태 ──
  const [mode, setMode] = useState<'yolo_world' | 'onnx' | 'locate_anything'>('yolo_world')
  const [confidence, setConfidence] = useState(0.25)
  const [iouThreshold, setIouThreshold] = useState(0.45)
  const [overwrite, setOverwrite] = useState(false)
  const [skipLabeled, setSkipLabeled] = useState(true)
  const [targetScope, setTargetScope] = useState<'all' | 'batch'>('all')
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [pollingRunId, setPollingRunId] = useState<number | null>(null)

  // YOLO-World
  const [textPrompts, setTextPrompts] = useState<string[]>([])

  // ONNX
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)

  const { data: runsData } = useQuery({
    queryKey: ['autoLabelRuns', selectedDataset?.id],
    queryFn: () => autoLabelApi.listRuns(selectedDataset!.id),
    enabled: !!selectedDataset,
    refetchInterval: pollingRunId ? 3000 : false,
    select: (r) => r.data,
  })

  const { data: batchesData } = useQuery({
    queryKey: ['imageBatches', selectedDataset?.id],
    queryFn: () => imagesApi.getBatches(selectedDataset!.id),
    enabled: !!selectedDataset,
    staleTime: 5000,
  })

  const { data: onnxModels, refetch: refetchModels } = useQuery({
    queryKey: ['onnxModels'],
    queryFn: () => onnxModelsApi.list(),
    staleTime: 30_000,
  })

  const latestRun = runsData?.items[0] ?? null

  useEffect(() => {
    if (latestRun && (latestRun.status === 'pending' || latestRun.status === 'running')) {
      setPollingRunId(latestRun.id)
    } else {
      setPollingRunId(null)
    }
  }, [latestRun?.status])

  const startMut = useMutation({
    mutationFn: () =>
      autoLabelApi.startRun(selectedDataset!.id, {
        mode,
        text_prompts: (mode === 'yolo_world' || mode === 'locate_anything') ? textPrompts : [],
        onnx_model_id: mode === 'onnx' ? selectedModelId! : undefined,
        confidence_threshold: confidence,
        iou_threshold: iouThreshold,
        overwrite: targetScope === 'batch' ? false : overwrite,
        skip_labeled: skipLabeled,
        upload_batch_id: targetScope === 'batch' ? selectedBatchId : null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['autoLabelRuns', selectedDataset?.id] }),
  })

  const deleteMut = useMutation({
    mutationFn: (runId: number) => autoLabelApi.deleteAnnotations(selectedDataset!.id, runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['autoLabelRuns', selectedDataset?.id] })
      qc.invalidateQueries({ queryKey: ['annotations'] })
    },
  })

  const cancelMut = useMutation({
    mutationFn: (runId: number) => autoLabelApi.cancelRun(selectedDataset!.id, runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['autoLabelRuns', selectedDataset?.id] })
    },
  })

  const deleteModelMut = useMutation({
    mutationFn: (modelId: number) => onnxModelsApi.delete(modelId),
    onSuccess: () => {
      refetchModels()
      setSelectedModelId(null)
    },
  })

  const isRunning = latestRun?.status === 'pending' || latestRun?.status === 'running'
  const canStart =
    !isRunning && !startMut.isPending &&
    ((mode === 'yolo_world' || mode === 'locate_anything') ? textPrompts.length > 0 : selectedModelId !== null) &&
    (targetScope === 'all' || selectedBatchId !== null)

  if (!selectedDataset) {
    return (
      <div className="page-empty">
        <Bot className="mx-auto mb-3 text-gray-300" size={48} />
        <p>홈에서 데이터셋을 선택해주세요.</p>
      </div>
    )
  }

  return (
    <>
      {uploadModalOpen && (
        <OnnxUploadModal
          onClose={() => setUploadModalOpen(false)}
          onUploaded={() => refetchModels()}
        />
      )}

      <div>
        <h1 className="page-header">AI 자동 레이블링</h1>
        <p className="page-subtitle">
          텍스트 프롬프트(YOLO-World, LocateAnything) 또는 커스텀 ONNX 모델로 바운딩 박스를 자동 생성합니다.
        </p>

        <div className="card mb-6">
          {/* 모드 토글 */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-5 w-fit">
            <button
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'yolo_world'
                  ? 'bg-white shadow text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
                }`}
              onClick={() => setMode('yolo_world')}
            >
              YOLO-World
            </button>
            <button
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${mode === 'locate_anything'
                  ? 'bg-white shadow text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
                }`}
              onClick={() => setMode('locate_anything')}
            >
              <Bot className="w-3.5 h-3.5" />
              LocateAnything
            </button>
            <button
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${mode === 'onnx'
                  ? 'bg-white shadow text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
                }`}
              onClick={() => setMode('onnx')}
            >
              <Server className="w-3.5 h-3.5" />
              커스텀 ONNX
            </button>
          </div>

          <h2 className="text-sm font-semibold text-gray-700 mb-4">실행 설정</h2>

          {/* YOLO-World / LocateAnything: 텍스트 프롬프트 */}
          {(mode === 'yolo_world' || mode === 'locate_anything') && (
            <div className="mb-4">
              <label className="form-label mb-1 block">
                탐지할 객체 (텍스트 프롬프트)
                <span className="text-gray-400 font-normal ml-1">Enter 또는 쉼표로 추가</span>
              </label>
              <TagInput
                tags={textPrompts}
                onChange={setTextPrompts}
                placeholder="예: person, car, dog ..."
              />
              {textPrompts.length === 0 && (
                <p className="text-xs text-red-500 mt-1">최소 하나 이상의 객체를 입력해주세요.</p>
              )}
            </div>
          )}

          {/* ONNX: 모델 선택 */}
          {mode === 'onnx' && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="form-label">모델 선택</label>
                <button
                  onClick={() => setUploadModalOpen(true)}
                  className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <Upload className="w-3.5 h-3.5" />
                  모델 업로드
                </button>
              </div>

              {!onnxModels || onnxModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-200 rounded-lg text-gray-400">
                  <Server className="w-8 h-8 mb-2" />
                  <p className="text-sm">업로드된 ONNX 모델이 없습니다.</p>
                  <button
                    onClick={() => setUploadModalOpen(true)}
                    className="mt-2 text-sm text-blue-600 hover:underline"
                  >
                    지금 업로드하기
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {onnxModels.map((m: OnnxModel) => (
                    <label
                      key={m.id}
                      className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${selectedModelId === m.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <input
                        type="radio"
                        name="onnxModel"
                        checked={selectedModelId === m.id}
                        onChange={() => setSelectedModelId(m.id)}
                        className="accent-blue-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{m.name}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          <span className="inline-block bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded mr-1">
                            {ARCH_OPTIONS.find(a => a.value === m.architecture)?.label ?? m.architecture}
                          </span>
                          {m.class_labels.join(', ')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-gray-400">{fmtBytes(m.file_size)}</span>
                        <button
                          type="button"
                          onClick={e => {
                            e.preventDefault()
                            if (confirm(`"${m.name}" 모델을 삭제하시겠습니까?`))
                              deleteModelMut.mutate(m.id)
                          }}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {selectedModelId === null && onnxModels && onnxModels.length > 0 && (
                <p className="text-xs text-red-500 mt-1">모델을 선택해주세요.</p>
              )}
            </div>
          )}

          {/* 대상 범위 선택 */}
          <div className="mb-5">
            <label className="form-label block mb-2">대상 이미지 범위</label>
            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="targetScope"
                  checked={targetScope === 'all'}
                  onChange={() => { setTargetScope('all'); setSelectedBatchId(null) }}
                  className="accent-blue-600"
                />
                전체 이미지
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="targetScope"
                  checked={targetScope === 'batch'}
                  onChange={() => setTargetScope('batch')}
                  className="accent-blue-600"
                />
                특정 업로드 배치 선택
              </label>
            </div>

            {targetScope === 'batch' && (
              <div className="pl-5">
                {!batchesData || batchesData.items.length === 0 ? (
                  <p className="text-xs text-gray-500 bg-gray-50 p-2.5 rounded-lg">등록된 업로드 배치가 없습니다.</p>
                ) : (
                  <select
                    value={selectedBatchId ?? ''}
                    onChange={e => setSelectedBatchId(e.target.value || null)}
                    className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">-- 배치를 선택해 주세요 --</option>
                    {batchesData.items.map((b: { batch_id: string | null; count: number }) => (
                      <option key={b.batch_id ?? 'legacy'} value={b.batch_id ?? ''}>
                        {b.batch_id ? `${b.batch_id} (${b.count}장)` : `기존 미지정 데이터 (${b.count}장)`}
                      </option>
                    ))}
                  </select>
                )}
                {selectedBatchId === null && batchesData && batchesData.items.length > 0 && (
                  <p className="text-xs text-red-500 mt-1">업로드 배치를 선택해주세요.</p>
                )}
              </div>
            )}
          </div>

          {/* 공통: 신뢰도 슬라이더 */}
          <div className="mb-4">
            <label className="form-label">
              신뢰도 임계값: <strong>{confidence.toFixed(2)}</strong>
            </label>
            <input
              type="range" min={0.01} max={0.99} step={0.01}
              value={confidence} onChange={e => setConfidence(Number(e.target.value))}
              className="w-full mt-1"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>낮음 (0.01)</span><span>높음 (0.99)</span>
            </div>
          </div>

          {/* ONNX 전용: IoU 슬라이더 */}
          {mode === 'onnx' && (
            <div className="mb-4">
              <label className="form-label">
                IoU 임계값 (NMS): <strong>{iouThreshold.toFixed(2)}</strong>
              </label>
              <input
                type="range" min={0.01} max={0.99} step={0.01}
                value={iouThreshold} onChange={e => setIouThreshold(Number(e.target.value))}
                className="w-full mt-1"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>엄격 (0.01)</span><span>느슨 (0.99)</span>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2.5 mb-5">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox" checked={skipLabeled}
                onChange={e => setSkipLabeled(e.target.checked)} className="rounded"
              />
              이미 레이블링 완료된 이미지 제외 (새로운 데이터만 진행)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox" checked={targetScope === 'batch' ? false : overwrite}
                onChange={e => setOverwrite(e.target.checked)} className="rounded"
                disabled={skipLabeled || targetScope === 'batch'}
              />
              <span className={(skipLabeled || targetScope === 'batch') ? 'text-gray-400' : ''}>
                기존 자동 레이블 덮어쓰기 {targetScope === 'batch' && '(배치 작업 시 지원 안 함)'}
              </span>
            </label>
          </div>

          <button
            className="btn-primary flex items-center gap-2"
            onClick={() => startMut.mutate()}
            disabled={!canStart}
          >
            {startMut.isPending || isRunning
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Play className="w-4 h-4" />}
            {isRunning ? '실행 중...' : '자동 레이블링 시작'}
          </button>

          {startMut.isError && (
            <p className="text-red-600 text-sm mt-2">{(startMut.error as Error).message}</p>
          )}
        </div>

        {/* 최근 실행 카드 */}
        {latestRun && (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">최근 실행</h2>
              <div className="flex items-center gap-2 text-sm">
                <div className="flex items-center gap-1">
                  {STATUS_ICONS[latestRun.status]}
                  <span>{STATUS_LABELS[latestRun.status] ?? latestRun.status}</span>
                </div>
                {(latestRun.status === 'pending' || latestRun.status === 'running') && (
                  <button
                    onClick={() => {
                      if (confirm('자동 레이블링 작업을 중지하시겠습니까?')) {
                        cancelMut.mutate(latestRun.id)
                      }
                    }}
                    disabled={cancelMut.isPending}
                    className="px-2 py-1 text-xs font-medium text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-40 transition-colors flex items-center gap-1"
                  >
                    {cancelMut.isPending
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <X className="w-3 h-3" />}
                    중지
                  </button>
                )}
              </div>
            </div>

            <div className="mb-3 flex flex-wrap gap-1.5">
              <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded font-medium">
                {latestRun.model_name}
              </span>
              {latestRun.text_prompts &&
                parseTextPrompts(latestRun.text_prompts).map(tag => (
                  <span key={tag} className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">
                    {tag}
                  </span>
                ))}
            </div>

            {(latestRun.status === 'running' || latestRun.status === 'completed') && (
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>진행률</span>
                  <span>{latestRun.processed_images} / {latestRun.total_images} 이미지</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{
                      width: latestRun.total_images > 0
                        ? `${(latestRun.processed_images / latestRun.total_images) * 100}%`
                        : '0%',
                    }}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="bg-gray-50 rounded p-2">
                <div className="font-semibold text-gray-800">{latestRun.total_images}</div>
                <div className="text-gray-500 text-xs">전체 이미지</div>
              </div>
              <div className="bg-gray-50 rounded p-2">
                <div className="font-semibold text-gray-800">{latestRun.processed_images}</div>
                <div className="text-gray-500 text-xs">처리 완료</div>
              </div>
              <div className="bg-gray-50 rounded p-2">
                <div className="font-semibold text-blue-600">{latestRun.total_annotations}</div>
                <div className="text-gray-500 text-xs">생성된 레이블</div>
              </div>
            </div>

            {latestRun.error_message && (
              <div className="mt-3 text-sm text-red-600 bg-red-50 p-2 rounded">
                {latestRun.error_message}
              </div>
            )}

            {latestRun.status === 'completed' && (
              <button
                className="btn-secondary flex items-center gap-2 mt-3 text-red-600 hover:text-red-700"
                onClick={() => deleteMut.mutate(latestRun.id)}
                disabled={deleteMut.isPending}
              >
                <Trash2 className="w-4 h-4" />
                자동 레이블 삭제
              </button>
            )}
          </div>
        )}

        {/* 실행 히스토리 */}
        {runsData && runsData.items.length > 1 && (
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">실행 히스토리</h2>
            <div className="space-y-2">
              {runsData.items.map((run: AutoLabelRun) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {STATUS_ICONS[run.status]}
                    <span className="text-gray-600 shrink-0">#{run.id}</span>
                    <span className="text-gray-500 shrink-0">conf {run.confidence_threshold.toFixed(2)}</span>
                    <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded shrink-0">
                      {run.model_name}
                    </span>
                    {run.text_prompts && (
                      <span className="text-gray-400 text-xs truncate">
                        [{parseTextPrompts(run.text_prompts).join(', ')}]
                      </span>
                    )}
                  </div>
                  <div className="text-gray-500 shrink-0 ml-2">
                    {run.total_annotations}개 레이블
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
