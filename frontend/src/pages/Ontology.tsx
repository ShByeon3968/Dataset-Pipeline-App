import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { GitMerge, RotateCcw, BookOpen, Trash2 } from 'lucide-react'
import { ontologyApi } from '../api/ontology'
import { classesApi } from '../api/classes'
import { useAppStore } from '../store'

export default function OntologyPage() {
  const qc = useQueryClient()
  const { selectedDataset } = useAppStore()
  const [selectedSources, setSelectedSources] = useState<number[]>([])
  const [targetName, setTargetName] = useState('')
  const [saveRule, setSaveRule] = useState(false)
  const [ruleName, setRuleName] = useState('')
  const [tab, setTab] = useState<'map' | 'rules' | 'history'>('map')

  const { data: classes } = useQuery({
    queryKey: ['classes', selectedDataset?.id],
    queryFn: () => classesApi.list(selectedDataset!.id),
    enabled: !!selectedDataset,
  })

  const { data: history } = useQuery({
    queryKey: ['ontology-history', selectedDataset?.id],
    queryFn: () => ontologyApi.history(selectedDataset!.id),
    enabled: !!selectedDataset && tab === 'history',
  })

  const { data: rules } = useQuery({
    queryKey: ['ontology-rules'],
    queryFn: ontologyApi.listRules,
    enabled: tab === 'rules',
  })

  const applyMapping = useMutation({
    mutationFn: () => ontologyApi.mapClasses(
      selectedDataset!.id, selectedSources, targetName, saveRule, saveRule ? ruleName : undefined
    ),
    onSuccess: (res) => {
      toast.success(`매핑 완료 — ${res.affected_annotations}개 주석 업데이트`)
      qc.invalidateQueries({ queryKey: ['classes', selectedDataset?.id] })
      qc.invalidateQueries({ queryKey: ['ontology-history', selectedDataset?.id] })
      qc.invalidateQueries({ queryKey: ['datasets'] })
      setSelectedSources([])
      setTargetName('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const undoHistory = useMutation({
    mutationFn: (historyId: number) => ontologyApi.undo(selectedDataset!.id, historyId),
    onSuccess: () => {
      toast.success('되돌리기 완료')
      qc.invalidateQueries({ queryKey: ['classes', selectedDataset?.id] })
      qc.invalidateQueries({ queryKey: ['ontology-history', selectedDataset?.id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteRule = useMutation({
    mutationFn: (id: number) => ontologyApi.deleteRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ontology-rules'] }),
  })

  if (!selectedDataset) {
    return <div className="card p-8 text-center text-gray-500">홈 화면에서 데이터셋을 선택하세요.</div>
  }

  return (
    <div>
      <h1 className="page-header">🔗 온톨로지 매핑</h1>
      <p className="page-subtitle">의미론적으로 동일한 클래스를 하나로 통합합니다.</p>

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { key: 'map', label: '클래스 매핑', icon: GitMerge },
          { key: 'rules', label: '저장된 규칙', icon: BookOpen },
          { key: 'history', label: '히스토리', icon: RotateCcw },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key as typeof tab)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* 매핑 */}
      {tab === 'map' && (
        <div className="grid grid-cols-2 gap-6">
          <div className="card p-5">
            <h2 className="font-semibold mb-3">소스 클래스 선택 (다중)</h2>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {classes?.map(cls => (
                <label key={cls.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSources.includes(cls.id)}
                    onChange={e => setSelectedSources(prev =>
                      e.target.checked ? [...prev, cls.id] : prev.filter(id => id !== cls.id)
                    )}
                  />
                  <span className="w-3 h-3 rounded-full" style={{ background: cls.color }} />
                  <span className="text-sm">{cls.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">통합 대상 클래스 이름</label>
              <input
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="예: Human"
                value={targetName}
                onChange={e => setTargetName(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={saveRule} onChange={e => setSaveRule(e.target.checked)} />
              규칙으로 저장
            </label>
            {saveRule && (
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="규칙 이름"
                value={ruleName}
                onChange={e => setRuleName(e.target.value)}
              />
            )}
            {selectedSources.length > 0 && targetName && (
              <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                <strong>{selectedSources.map(id => classes?.find(c => c.id === id)?.name).join(', ')}</strong>
                {' → '}<strong>{targetName}</strong>
              </div>
            )}
            <button
              onClick={() => applyMapping.mutate()}
              disabled={!selectedSources.length || !targetName || applyMapping.isPending}
              className="btn-primary w-full disabled:opacity-50"
            >
              {applyMapping.isPending ? '적용 중...' : '매핑 적용'}
            </button>
          </div>
        </div>
      )}

      {/* 규칙 목록 */}
      {tab === 'rules' && (
        <div className="card p-5">
          {(!rules || rules.length === 0) ? (
            <p className="text-center text-gray-500 py-8">저장된 규칙이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {rules.map(rule => (
                <div key={rule.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium text-sm">{rule.name}</div>
                    <div className="text-xs text-gray-500">
                      {rule.rule_data.sources.join(', ')} → {rule.rule_data.target}
                    </div>
                  </div>
                  <button onClick={() => deleteRule.mutate(rule.id)} className="text-red-400 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 히스토리 */}
      {tab === 'history' && (
        <div className="card p-5">
          {(!history || history.length === 0) ? (
            <p className="text-center text-gray-500 py-8">히스토리가 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium text-sm">{h.action}</div>
                    <div className="text-xs text-gray-400">
                      {new Date(h.created_at).toLocaleString('ko-KR')}
                    </div>
                  </div>
                  <button
                    onClick={() => undoHistory.mutate(h.id)}
                    className="btn-secondary flex items-center gap-1 text-xs"
                  >
                    <RotateCcw className="w-3 h-3" /> 되돌리기
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
