import { useState, useEffect } from 'react';
import { Play, Activity, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import api from '../api/client';

export default function SyntheticData() {
    const [activeTab, setActiveTab] = useState<'qwen' | 'flux'>('qwen');
    const [datasets, setDatasets] = useState<any[]>([]);
    const [selectedDataset, setSelectedDataset] = useState<number | ''>('');
    const [batches, setBatches] = useState<any[]>([]);
    const [selectedBatch, setSelectedBatch] = useState<string | ''>('');

    const [prompt, setPrompt] = useState('');

    // Flux settings
    const [strength, setStrength] = useState(0.75);
    const [guidanceScale, setGuidanceScale] = useState(7.5);
    const [inferenceSteps, setInferenceSteps] = useState(50);
    const [seed, setSeed] = useState(42);
    const [gpus, setGpus] = useState('0');


    // Task State
    const [genTaskId, setGenTaskId] = useState('');
    const [genStatus, setGenStatus] = useState<string>('');
    const [genLog, setGenLog] = useState('');
    const [genResult, setGenResult] = useState<any>(null);

    const [evalTaskId, setEvalTaskId] = useState('');
    const [evalStatus, setEvalStatus] = useState<string>('');
    const [evalLog, setEvalLog] = useState('');
    const [evalResult, setEvalResult] = useState<any>(null);

    useEffect(() => {
        // Fetch datasets
        api.get('/datasets').then((res) => setDatasets(res.data.items || []));
    }, []);

    useEffect(() => {
        if (selectedDataset) {
            api.get(`/datasets/${selectedDataset}/images/batches`).then((res) => {
                setBatches(res.data.items || []);
                setSelectedBatch('');
            });
        } else {
            setBatches([]);
            setSelectedBatch('');
        }
    }, [selectedDataset]);

    // Polling for generation status
    useEffect(() => {
        let interval: any;
        if (genTaskId && (genStatus === 'pending' || genStatus === 'preparing' || genStatus === 'running')) {
            interval = setInterval(() => {
                api.get(`/synthetic/status/${genTaskId}`).then((res) => {
                    setGenStatus(res.data.status);
                    setGenLog(res.data.last_log || '');
                    if (res.data.status === 'done' || res.data.status === 'error') {
                        setGenResult(res.data.result);
                    }
                });
            }, 2000);
        }
        return () => clearInterval(interval);
    }, [genTaskId, genStatus]);

    // Polling for eval status
    useEffect(() => {
        let interval: any;
        if (evalTaskId && (evalStatus === 'pending' || evalStatus === 'running')) {
            interval = setInterval(() => {
                api.get(`/synthetic/status/${evalTaskId}`).then((res) => {
                    setEvalStatus(res.data.status);
                    setEvalLog(res.data.last_log || '');
                    if (res.data.status === 'done' || res.data.status === 'error') {
                        setEvalResult(res.data.result);
                    }
                });
            }, 2000);
        }
        return () => clearInterval(interval);
    }, [evalTaskId, evalStatus]);

    const handleGenerate = async () => {
        if (!selectedDataset) {
            alert("데이터셋을 선택해주세요.");
            return;
        }
        if (!prompt) {
            alert("프롬프트를 입력해주세요.");
            return;
        }

        setGenStatus('pending');
        setGenLog('요청 중...');
        setGenResult(null);
        setEvalTaskId('');
        setEvalStatus('');

        try {
            const payload: any = {
                dataset_id: Number(selectedDataset),
                batch_id: selectedBatch === '' ? null : selectedBatch,
                model_type: activeTab,
                prompt: prompt,
            };

            if (activeTab === 'flux') {
                payload.gpus = gpus.split(',').map(s => parseInt(s.trim()));
                payload.strength = strength;
                payload.guidance_scale = guidanceScale;
                payload.inference_steps = inferenceSteps;
                payload.seed = seed;
            }

            const res = await api.post('/synthetic/generate', payload);
            setGenTaskId(res.data.task_id);
        } catch (e: any) {
            console.error(e);
            setGenStatus('error');
            setGenLog('요청 실패');
        }
    };

    const handleEvaluate = async (eval_type: string) => {
        if (!genTaskId || genStatus !== 'done') {
            alert("생성 작업이 완료된 후 평가를 진행할 수 있습니다.");
            return;
        }

        setEvalStatus('pending');
        setEvalLog(`${eval_type} 평가 요청 중...`);
        setEvalResult(null);

        try {
            const res = await api.post('/synthetic/evaluate', {
                task_id: genTaskId,
                eval_type: eval_type
            });
            setEvalTaskId(res.data.task_id);
        } catch (e: any) {
            console.error(e);
            setEvalStatus('error');
            setEvalLog('평가 요청 실패');
        }
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">합성데이터 생성 및 검증</h1>
                <p className="text-sm text-gray-500 mt-1">
                    업로드된 이미지를 바탕으로 Qwen, Flux 모델을 사용해 합성 이미지를 생성하고 품질을 검증합니다.
                </p>
            </div>

            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm space-y-6">
                <h2 className="text-lg font-semibold border-b pb-2">1. 데이터 및 모델 설정</h2>

                <div className="grid grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">데이터셋 선택</label>
                        <select
                            className="w-full border border-gray-300 rounded-md p-2"
                            value={selectedDataset}
                            onChange={(e) => setSelectedDataset(e.target.value ? Number(e.target.value) : '')}
                        >
                            <option value="">데이터셋을 선택하세요</option>
                            {datasets.map(d => (
                                <option key={d.id} value={d.id}>{d.name} (이미지: {d.image_count}장)</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">배치 선택 (선택사항)</label>
                        <select
                            className="w-full border border-gray-300 rounded-md p-2"
                            value={selectedBatch}
                            onChange={(e) => setSelectedBatch(e.target.value)}
                            disabled={!selectedDataset}
                        >
                            <option value="">전체 이미지 사용</option>
                            {batches.map(b => (
                                <option key={b.batch_id} value={b.batch_id}>{b.batch_id} ({b.count}장)</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">생성 프롬프트 (Edit Prompt)</label>
                    <textarea
                        className="w-full border border-gray-300 rounded-md p-3 h-24"
                        placeholder="예: elevated shot wide shot, body partially obscured by large machinery high angle"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">모델 선택</label>
                    <div className="flex border-b border-gray-200">
                        <button
                            onClick={() => setActiveTab('qwen')}
                            className={clsx("px-6 py-2.5 text-sm font-medium border-b-2 transition-colors",
                                activeTab === 'qwen' ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700")}
                        >
                            Qwen (화각 변화 특화)
                        </button>
                        <button
                            onClick={() => setActiveTab('flux')}
                            className={clsx("px-6 py-2.5 text-sm font-medium border-b-2 transition-colors",
                                activeTab === 'flux' ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700")}
                        >
                            Flux (최신/고품질)
                        </button>
                    </div>
                </div>

                {activeTab === 'flux' && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-md border">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">사용 GPU (콤마구분)</label>
                            <input type="text" className="w-full border rounded p-1 text-sm" value={gpus} onChange={e => setGpus(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Strength (노이즈 강도)</label>
                            <input type="number" step="0.01" className="w-full border rounded p-1 text-sm" value={strength} onChange={e => setStrength(Number(e.target.value))} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Guidance Scale</label>
                            <input type="number" step="0.1" className="w-full border rounded p-1 text-sm" value={guidanceScale} onChange={e => setGuidanceScale(Number(e.target.value))} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Inference Steps</label>
                            <input type="number" className="w-full border rounded p-1 text-sm" value={inferenceSteps} onChange={e => setInferenceSteps(Number(e.target.value))} />
                        </div>
                    </div>
                )}

                <div className="flex justify-end">
                    <button
                        onClick={handleGenerate}
                        disabled={['pending', 'preparing', 'running'].includes(genStatus)}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-md font-medium disabled:opacity-50"
                    >
                        {['pending', 'preparing', 'running'].includes(genStatus) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        생성 시작
                    </button>
                </div>

                {/* Generation Status */}
                {genStatus && (
                    <div className="bg-gray-900 text-gray-100 p-4 rounded-md font-mono text-sm space-y-2">
                        <div className="flex items-center gap-2">
                            {['pending', 'preparing', 'running'].includes(genStatus) && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                            {genStatus === 'done' && <CheckCircle className="w-4 h-4 text-green-400" />}
                            {genStatus === 'error' && <AlertCircle className="w-4 h-4 text-red-400" />}
                            <span className="font-bold">상태: {genStatus.toUpperCase()}</span>
                        </div>
                        <div className="border-t border-gray-700 pt-2 text-gray-400">
                            {genLog || "대기 중..."}
                        </div>
                        {['pending', 'preparing', 'running'].includes(genStatus) && (
                            <>
                                <div className="w-full bg-gray-700 rounded-full h-2.5 mt-3 overflow-hidden border border-gray-600">
                                    <div 
                                      className="bg-blue-500 h-2.5 rounded-full transition-all duration-300 ease-out" 
                                      style={{ width: `${genResult?.progress || 0}%` }}
                                    ></div>
                                </div>
                                {genResult?.progress != null && (
                                    <div className="text-right text-xs text-blue-300 mt-1">
                                        {genResult.progress}% 완료
                                    </div>
                                )}
                            </>
                        )}
                        {genResult && genResult.output_dir && (
                            <div className="text-green-300 mt-2 text-xs">
                                생성 완료: {genResult.output_dir}
                                {genResult.batch_id && <span className="block mt-1">DB 배치 등록 완료: {genResult.batch_id}</span>}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className={clsx("bg-white p-6 rounded-lg border border-gray-200 shadow-sm space-y-6 transition-opacity", genStatus === 'done' ? "opacity-100" : "opacity-50 pointer-events-none")}>
                <h2 className="text-lg font-semibold border-b pb-2 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-purple-500" />
                    2. 품질 검증 (Evaluation)
                </h2>
                <p className="text-sm text-gray-500">생성된 합성 데이터의 품질을 검증합니다.</p>

                <div className="flex gap-4">
                    <button onClick={() => handleEvaluate('domain_gap')} className="bg-purple-100 text-purple-700 hover:bg-purple-200 px-4 py-2 rounded-md font-medium text-sm transition-colors border border-purple-200">
                        Domain Gap 측정 (FID/KID)
                    </button>
                    <button onClick={() => handleEvaluate('lpips')} className="bg-purple-100 text-purple-700 hover:bg-purple-200 px-4 py-2 rounded-md font-medium text-sm transition-colors border border-purple-200">
                        인지 유사도 측정 (LPIPS)
                    </button>
                    <button onClick={() => handleEvaluate('quality')} className="bg-purple-100 text-purple-700 hover:bg-purple-200 px-4 py-2 rounded-md font-medium text-sm transition-colors border border-purple-200">
                        이미지 품질 측정 (BRISQUE/Sharpness)
                    </button>
                </div>

                {/* Evaluation Status */}
                {evalStatus && (
                    <div className="bg-gray-900 text-gray-100 p-4 rounded-md font-mono text-sm space-y-2 mt-4">
                        <div className="flex items-center gap-2">
                            {['pending', 'running'].includes(evalStatus) && <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />}
                            {evalStatus === 'done' && <CheckCircle className="w-4 h-4 text-green-400" />}
                            {evalStatus === 'error' && <AlertCircle className="w-4 h-4 text-red-400" />}
                            <span className="font-bold">상태: {evalStatus.toUpperCase()}</span>
                        </div>
                        <div className="border-t border-gray-700 pt-2 text-gray-400">
                            {evalLog || "대기 중..."}
                        </div>
                        {['pending', 'running'].includes(evalStatus) && (
                            <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2 overflow-hidden">
                                <div className="bg-purple-500 h-1.5 rounded-full animate-pulse w-full"></div>
                            </div>
                        )}
                        {evalResult && evalResult.logs && (
                            <div className="mt-4 bg-black p-3 rounded text-xs text-green-400 max-h-64 overflow-y-auto font-mono whitespace-pre-wrap">
                                {evalResult.logs.join('\n')}
                            </div>
                        )}
                    </div>
                )}
            </div>

        </div>
    );
}
