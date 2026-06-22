import { useState, useEffect } from 'react';
import { Play, Activity, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import api from '../api/client';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';

function renderVisualMetrics(evalType: string, metrics: any) {
    if (evalType === 'domain_gap') {
        const fid = metrics.fid || 0;
        const kid = metrics.kid || 0;
        
        let fidStyle = {
            text: 'text-green-600',
            bg: 'bg-green-50',
            border: 'border-green-200',
            status: '우수 (낮은 도메인 갭)'
        };
        if (fid > 150) {
            fidStyle = {
                text: 'text-red-600',
                bg: 'bg-red-50',
                border: 'border-red-200',
                status: '높음 (도메인 갭 큼)'
            };
        } else if (fid > 50) {
            fidStyle = {
                text: 'text-yellow-600',
                bg: 'bg-yellow-50',
                border: 'border-yellow-200',
                status: '보통'
            };
        }

        let kidStyle = {
            text: 'text-green-600',
            bg: 'bg-green-50',
            border: 'border-green-200',
            status: '우수'
        };
        if (kid > 0.05) {
            kidStyle = {
                text: 'text-red-600',
                bg: 'bg-red-50',
                border: 'border-red-200',
                status: '도메인 차이 큼'
            };
        } else if (kid > 0.02) {
            kidStyle = {
                text: 'text-yellow-600',
                bg: 'bg-yellow-50',
                border: 'border-yellow-200',
                status: '보통'
            };
        }

        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className={`p-5 rounded-xl border ${fidStyle.border} ${fidStyle.bg} transition-all duration-300 shadow-sm`}>
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Fréchet Inception Distance (FID)</p>
                            <h4 className="text-3xl font-extrabold mt-2 font-sans text-gray-900">{fid.toFixed(4)}</h4>
                        </div>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${fidStyle.text} border-current bg-white`}>
                            {fidStyle.status}
                        </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-4 leading-relaxed">
                        FID는 실제 이미지 분포와 생성 이미지 분포 간의 거리를 측정합니다. 0에 가까울수록 두 분포가 유사하며, 합성 데이터가 실제 데이터의 특성을 잘 모사하고 있음을 의미합니다.
                    </p>
                </div>

                <div className={`p-5 rounded-xl border ${kidStyle.border} ${kidStyle.bg} transition-all duration-300 shadow-sm`}>
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Kernel Inception Distance (KID)</p>
                            <h4 className="text-3xl font-extrabold mt-2 font-sans text-gray-900">{kid.toFixed(4)}</h4>
                        </div>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${kidStyle.text} border-current bg-white`}>
                            {kidStyle.status}
                        </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-4 leading-relaxed">
                        KID는 소량의 데이터셋에서 FID의 편향(Bias)을 수정한 강건한 지표입니다. 값이 낮을수록 생성된 합성 이미지들의 표현 방식이 자연스럽고 일관적임을 뜻합니다.
                    </p>
                </div>
            </div>
        );
    }

    if (evalType === 'lpips') {
        const avg = metrics.avg_score || 0;
        const std = metrics.std_score || 0;
        const total = metrics.total_pairs || 0;
        const details = metrics.details || [];
        
        const chartData = details.map((d: any) => ({
            name: d.filename.length > 15 ? d.filename.substring(0, 15) + '...' : d.filename,
            fullName: d.filename,
            score: d.score,
        }));

        let lpipsStyle = {
            text: 'text-green-600',
            bg: 'bg-green-50',
            border: 'border-green-200',
            status: '우수 (높은 시각적 유사도)'
        };
        if (avg > 0.5) {
            lpipsStyle = {
                text: 'text-red-600',
                bg: 'bg-red-50',
                border: 'border-red-200',
                status: '미흡 (원래 이미지와 변형 큼)'
            };
        } else if (avg > 0.25) {
            lpipsStyle = {
                text: 'text-yellow-600',
                bg: 'bg-yellow-50',
                border: 'border-yellow-200',
                status: '보통'
            };
        }

        return (
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className={`p-4 rounded-lg border ${lpipsStyle.border} ${lpipsStyle.bg} shadow-sm`}>
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">평균 LPIPS 거리</p>
                        <h4 className="text-2xl font-extrabold mt-1 font-sans text-gray-900">{avg.toFixed(4)}</h4>
                        <span className="text-[10px] text-gray-500 mt-1 block">LPIPS가 0에 가까울수록 원본과 인간 지각적 관점에서 일치함</span>
                    </div>
                    <div className="p-4 rounded-lg border border-gray-200 bg-gray-50 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">표준 편차 (Std Dev)</p>
                        <h4 className="text-2xl font-extrabold mt-1 text-gray-900 font-sans">{std.toFixed(4)}</h4>
                        <span className="text-[10px] text-gray-500 mt-1 block">합성 품질의 일관성 (낮을수록 균일함)</span>
                    </div>
                    <div className="p-4 rounded-lg border border-gray-200 bg-gray-50 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">총 평가 이미지 쌍</p>
                        <h4 className="text-2xl font-extrabold mt-1 text-gray-900 font-sans">{total} 쌍</h4>
                        <span className="text-[10px] text-gray-500 mt-1 block">대조군 이미지 쌍 개수</span>
                    </div>
                </div>

                {chartData.length > 0 && (
                    <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-sm">
                        <p className="text-sm font-semibold mb-4 text-gray-800">🖼️ 이미지별 LPIPS 상세 분석 (낮을수록 우수)</p>
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="name" angle={-15} textAnchor="end" interval={0} tick={{ fontSize: 10 }} />
                                    <YAxis tick={{ fontSize: 10 }} domain={[0, 1]} />
                                    <Tooltip formatter={(value: any) => [`${value}`, 'LPIPS 거리']} />
                                    <Bar dataKey="score" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                        <p className="text-xs font-semibold text-gray-700">LPIPS 개별 점수 목록</p>
                    </div>
                    <table className="min-w-full divide-y divide-gray-200 text-xs">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase">파일명</th>
                                <th className="px-4 py-2 text-right font-medium text-gray-500 uppercase">LPIPS Score (거리)</th>
                                <th className="px-4 py-2 text-center font-medium text-gray-500 uppercase">상태</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {details.map((d: any, idx: number) => {
                                let statusText = '우수';
                                let badgeColor = 'text-green-700 bg-green-50 border-green-200';
                                if (d.score > 0.5) {
                                    statusText = '변화 큼';
                                    badgeColor = 'text-red-700 bg-red-50 border-red-200';
                                } else if (d.score > 0.25) {
                                    statusText = '보통';
                                    badgeColor = 'text-yellow-700 bg-yellow-50 border-yellow-200';
                                }
                                return (
                                    <tr key={idx} className="hover:bg-gray-50">
                                        <td className="px-4 py-2 font-mono text-gray-750">{d.filename}</td>
                                        <td className="px-4 py-2 text-right font-bold text-gray-900 font-mono">{d.score.toFixed(4)}</td>
                                        <td className="px-4 py-2 text-center">
                                            <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${badgeColor}`}>
                                                {statusText}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    if (evalType === 'quality') {
        const brisque = metrics.avg_brisque || 0;
        const sharpness = metrics.avg_sharpness || 0;
        const total = metrics.total_images || 0;
        const details = metrics.details || [];
        
        const chartData = details.map((d: any) => ({
            name: d.Filename.length > 15 ? d.Filename.substring(0, 15) + '...' : d.Filename,
            brisque: d.BRISQUE,
            sharpness: d.Sharpness,
        }));

        let brisqueStyle = {
            text: 'text-green-600',
            bg: 'bg-green-50',
            border: 'border-green-200',
            status: '매우 양호 (왜곡 없음)'
        };
        if (brisque > 60) {
            brisqueStyle = {
                text: 'text-red-600',
                bg: 'bg-red-50',
                border: 'border-red-200',
                status: '품질 낮음 (왜곡/노이즈 심함)'
            };
        } else if (brisque > 35) {
            brisqueStyle = {
                text: 'text-yellow-600',
                bg: 'bg-yellow-50',
                border: 'border-yellow-200',
                status: '보통'
            };
        }

        return (
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className={`p-4 rounded-lg border ${brisqueStyle.border} ${brisqueStyle.bg} shadow-sm`}>
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">평균 BRISQUE 지수</p>
                        <h4 className="text-2xl font-extrabold mt-1 font-sans text-gray-900">{brisque.toFixed(4)}</h4>
                        <span className="text-[10px] text-gray-500 mt-1 block">0에 가까울수록 왜곡/노이즈가 없음 (무참조 화질)</span>
                    </div>
                    <div className="p-4 rounded-lg border border-gray-200 bg-gray-50 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">평균 Sharpness (선명도)</p>
                        <h4 className="text-2xl font-extrabold mt-1 text-gray-900 font-sans">{sharpness.toFixed(2)}</h4>
                        <span className="text-[10px] text-gray-500 mt-1 block">라플라시안 분산 기반 선명도 지수 (높을수록 디테일함)</span>
                    </div>
                    <div className="p-4 rounded-lg border border-gray-200 bg-gray-50 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">총 평가 이미지 개수</p>
                        <h4 className="text-2xl font-extrabold mt-1 text-gray-900 font-sans">{total} 장</h4>
                        <span className="text-[10px] text-gray-500 mt-1 block">합성 배치 내 전체 대상</span>
                    </div>
                </div>

                {chartData.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-sm">
                            <p className="text-sm font-semibold mb-4 text-gray-800">📉 이미지별 BRISQUE 왜곡도 (낮을수록 우수)</p>
                            <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" angle={-15} textAnchor="end" interval={0} tick={{ fontSize: 10 }} />
                                        <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                                        <Tooltip formatter={(value: any) => [`${value}`, 'BRISQUE']} />
                                        <Bar dataKey="brisque" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-sm">
                            <p className="text-sm font-semibold mb-4 text-gray-800">📈 이미지별 Sharpness 선명도 (높을수록 우수)</p>
                            <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" angle={-15} textAnchor="end" interval={0} tick={{ fontSize: 10 }} />
                                        <YAxis tick={{ fontSize: 10 }} />
                                        <Tooltip formatter={(value: any) => [`${value.toFixed(2)}`, 'Sharpness']} />
                                        <Bar dataKey="sharpness" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                )}

                <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                        <p className="text-xs font-semibold text-gray-750">이미지별 품질 상세 정보 목록</p>
                    </div>
                    <table className="min-w-full divide-y divide-gray-200 text-xs">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-2 text-left font-medium text-gray-500 uppercase">파일명</th>
                                <th className="px-4 py-2 text-right font-medium text-gray-500 uppercase">BRISQUE (왜곡도)</th>
                                <th className="px-4 py-2 text-right font-medium text-gray-500 uppercase">Sharpness (선명도)</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {details.map((d: any, idx: number) => (
                                <tr key={idx} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 font-mono text-gray-750">{d.Filename}</td>
                                    <td className="px-4 py-2 text-right font-bold text-gray-900 font-mono">{d.BRISQUE.toFixed(4)}</td>
                                    <td className="px-4 py-2 text-right font-bold text-blue-600 font-mono">{d.Sharpness.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return null;
}

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

    const [evalRealBatch, setEvalRealBatch] = useState<string | ''>('');
    const [evalSynBatch, setEvalSynBatch] = useState<string | ''>('');

    const fetchBatches = () => {
        if (selectedDataset) {
            api.get(`/datasets/${selectedDataset}/images/batches`).then((res) => {
                setBatches(res.data.items || []);
            });
        } else {
            setBatches([]);
        }
    };

    useEffect(() => {
        fetchBatches();
        setSelectedBatch('');
        setEvalRealBatch('');
        setEvalSynBatch('');
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
                        if (res.data.status === 'done') {
                            fetchBatches();
                            if (res.data.result.batch_id) {
                                setEvalSynBatch(res.data.result.batch_id);
                            }
                        }
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
                        setEvalResult(res.data);
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
        if (!selectedDataset) {
            alert("데이터셋을 선택해주세요.");
            return;
        }
        if (!evalSynBatch) {
            alert("평가 대상 합성 배치를 선택해주세요.");
            return;
        }

        setEvalStatus('pending');
        setEvalLog(`${eval_type} 평가 요청 중...`);
        setEvalResult(null);

        try {
            const res = await api.post('/synthetic/evaluate', {
                dataset_id: Number(selectedDataset),
                real_batch_id: evalRealBatch === '' ? null : evalRealBatch,
                synthetic_batch_id: evalSynBatch,
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

            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm space-y-6">
                <h2 className="text-lg font-semibold border-b pb-2 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-purple-500" />
                    2. 품질 검증 (Evaluation)
                </h2>
                <p className="text-sm text-gray-500">생성된 합성 데이터의 품질을 검증합니다.</p>

                <div className="grid grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">비교 대상 원본 배치 (LPIPS/FID용)</label>
                        <select
                            className="w-full border border-gray-300 rounded-md p-2 bg-white"
                            value={evalRealBatch}
                            onChange={(e) => setEvalRealBatch(e.target.value)}
                            disabled={!selectedDataset}
                        >
                            <option value="">전체 원본 이미지 (synthetic_ 제외)</option>
                            {batches.filter(b => b.batch_id && !b.batch_id.startsWith('synthetic_')).map(b => (
                                <option key={b.batch_id} value={b.batch_id}>{b.batch_id} ({b.count}장)</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">평가 대상 합성 배치</label>
                        <select
                            className="w-full border border-gray-300 rounded-md p-2 bg-white"
                            value={evalSynBatch}
                            onChange={(e) => setEvalSynBatch(e.target.value)}
                            disabled={!selectedDataset}
                        >
                            <option value="">평가할 합성 배치를 선택하세요</option>
                            {batches.filter(b => b.batch_id && b.batch_id.startsWith('synthetic_')).map(b => (
                                <option key={b.batch_id} value={b.batch_id}>{b.batch_id} ({b.count}장)</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex gap-4">
                    <button 
                        onClick={() => handleEvaluate('domain_gap')} 
                        disabled={!selectedDataset || !evalSynBatch || ['pending', 'running'].includes(evalStatus)}
                        className="bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 px-4 py-2 rounded-md font-medium text-sm transition-colors border border-purple-200"
                    >
                        Domain Gap 측정 (FID/KID)
                    </button>
                    <button 
                        onClick={() => handleEvaluate('lpips')} 
                        disabled={!selectedDataset || !evalSynBatch || ['pending', 'running'].includes(evalStatus)}
                        className="bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 px-4 py-2 rounded-md font-medium text-sm transition-colors border border-purple-200"
                    >
                        인지 유사도 측정 (LPIPS)
                    </button>
                    <button 
                        onClick={() => handleEvaluate('quality')} 
                        disabled={!selectedDataset || !evalSynBatch || ['pending', 'running'].includes(evalStatus)}
                        className="bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 px-4 py-2 rounded-md font-medium text-sm transition-colors border border-purple-200"
                    >
                        이미지 품질 측정 (BRISQUE/Sharpness)
                    </button>
                </div>

                {/* Evaluation Status */}
                {evalStatus && (
                    <div className="space-y-4 mt-4">
                        <div className="bg-gray-900 text-gray-100 p-4 rounded-md font-mono text-sm space-y-2">
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
                            {evalResult?.result?.logs && (
                                <div className="mt-4 bg-black p-3 rounded text-xs text-green-400 max-h-40 overflow-y-auto font-mono whitespace-pre-wrap">
                                    {evalResult.result.logs.join('\n')}
                                </div>
                            )}
                        </div>
                        
                        {evalStatus === 'done' && evalResult?.result?.metrics && (
                            <div className="mt-6 space-y-6">
                                <h3 className="text-md font-semibold text-gray-900 border-b pb-2 flex items-center gap-2">
                                    <span>📊 품질 검증 상세 결과 시각화</span>
                                </h3>
                                {renderVisualMetrics(evalResult.eval_type, evalResult.result.metrics)}
                            </div>
                        )}
                    </div>
                )}
            </div>

        </div>
    );
}
