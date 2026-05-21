import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, Play, Trash2, X, Plus, CheckCircle, AlertCircle, Clock, Loader2 } from 'lucide-react'
import { autoLabelApi, AutoLabelRun } from '../api/autoLabel'
import { useAppStore } from '../store'

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="w-4 h-4 text-yellow-500" />,
  running: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  completed: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <AlertCircle className="w-4 h-4 text-red-500" />,
}

const STATUS_LABELS: Record<string, string> = {
  pending: '대기 중',
  running: '실행 중',
  completed: '완료',
  failed: '실패',
}

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

export default function AutoLabel() {
  const { selectedDataset } = useAppStore()
  const qc = useQueryClient()

  const [confidence, setConfidence] = useState(0.25)
  const [overwrite, setOverwrite] = useState(false)
  const [pollingRunId, setPollingRunId] = useState<number | null>(null)

  const [textPrompts, setTextPrompts] = useState<string[]>([])
  const [promptInput, setPromptInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addPrompt = (value: string) => {
    const trimmed = value.trim()
    if (trimmed && !textPrompts.includes(trimmed)) {
      setTextPrompts((prev) => [...prev, trimmed])
    }
    setPromptInput('')
  }

  const removePrompt = (tag: string) => {
    setTextPrompts((prev) => prev.filter((t) => t !== tag))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addPrompt(promptInput)
    } else if (e.key === 'Backspace' && promptInput === '' && textPrompts.length > 0) {
      setTextPrompts((prev) => prev.slice(0, -1))
    }
  }

  const { data: runsData } = useQuery({
    queryKey: ['autoLabelRuns', selectedDataset?.id],
    queryFn: () => autoLabelApi.listRuns(selectedDataset!.id),
    enabled: !!selectedDataset,
    refetchInterval: pollingRunId ? 3000 : false,
    select: (r) => r.data,
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
        text_prompts: textPrompts,
        confidence_threshold: confidence,
        overwrite,
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

  const isRunning = latestRun?.status === 'pending' || latestRun?.status === 'running'
  const canStart = textPrompts.length > 0 && !isRunning && !startMut.isPending

  if (!selectedDataset) {
    return (
      <div className="page-empty">
        <Bot className="mx-auto mb-3 text-gray-300" size={48} />
        <p>홈에서 데이터셋을 선택해주세요.</p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="page-header">AI 자동 레이블링</h1>
      <p className="page-subtitle">
        YOLO-Wolrd 모델로 텍스트 프롬프트를 기반으로 객체를 세그먼트하고 바운딩 박스를 생성합니다.
      </p>

      <div className="card mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">실행 설정</h2>

        {/* Text Prompt Tag Input */}
        <div className="mb-4">
          <label className="form-label mb-1 block">
            탐지할 객체 (텍스트 프롬프트)
            <span className="text-gray-400 font-normal ml-1">Enter 또는 쉼표로 추가</span>
          </label>
          <div
            className="flex flex-wrap gap-2 p-2 border border-gray-300 rounded-lg min-h-[44px] cursor-text focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 bg-white"
            onClick={() => inputRef.current?.focus()}
          >
            {textPrompts.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-md"
              >
                {tag}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removePrompt(tag) }}
                  className="hover:text-blue-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => { if (promptInput.trim()) addPrompt(promptInput) }}
              placeholder={textPrompts.length === 0 ? '예: person, car, dog ...' : ''}
              className="flex-1 min-w-[140px] outline-none text-sm bg-transparent"
            />
          </div>
          {textPrompts.length === 0 && (
            <p className="text-xs text-red-500 mt-1">최소 하나 이상의 객체를 입력해주세요.</p>
          )}
        </div>

        {/* Confidence Slider */}
        <div className="mb-4">
          <label className="form-label">
            신뢰도 임계값: <strong>{confidence.toFixed(2)}</strong>
          </label>
          <input
            type="range"
            min={0.01}
            max={0.99}
            step={0.01}
            value={confidence}
            onChange={(e) => setConfidence(Number(e.target.value))}
            className="w-full mt-1"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>낮음 (0.01)</span>
            <span>높음 (0.99)</span>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
            className="rounded"
          />
          기존 자동 레이블 덮어쓰기
        </label>

        <button
          className="btn-primary flex items-center gap-2"
          onClick={() => startMut.mutate()}
          disabled={!canStart}
        >
          {startMut.isPending || isRunning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {isRunning ? '실행 중...' : '자동 레이블링 시작'}
        </button>

        {startMut.isError && (
          <p className="text-red-600 text-sm mt-2">{(startMut.error as Error).message}</p>
        )}
      </div>

      {/* Progress card */}
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
                  {cancelMut.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                  중지
                </button>
              )}
            </div>
          </div>

          {latestRun.text_prompts && (
            <div className="mb-3 flex flex-wrap gap-1">
              {parseTextPrompts(latestRun.text_prompts).map((tag) => (
                <span
                  key={tag}
                  className="inline-block px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {(latestRun.status === 'running' || latestRun.status === 'completed') && (
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>진행률</span>
                <span>
                  {latestRun.processed_images} / {latestRun.total_images} 이미지
                </span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{
                    width:
                      latestRun.total_images > 0
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

      {/* History */}
      {runsData && runsData.items.length > 1 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">실행 히스토리</h2>
          <div className="space-y-2">
            {runsData.items.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded text-sm"
              >
                <div className="flex items-center gap-2">
                  {STATUS_ICONS[run.status]}
                  <span className="text-gray-600">#{run.id}</span>
                  <span className="text-gray-500">
                    신뢰도 {run.confidence_threshold.toFixed(2)}
                  </span>
                  {run.text_prompts && (
                    <span className="text-gray-400 text-xs">
                      [{parseTextPrompts(run.text_prompts).join(', ')}]
                    </span>
                  )}
                </div>
                <div className="text-gray-500">
                  {run.total_annotations}개 레이블
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
