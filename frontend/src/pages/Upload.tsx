import { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Upload as UploadIcon, FolderPlus, Image as ImageIcon,
  ChevronLeft, ChevronRight, Trash2, Eye, EyeOff,
} from 'lucide-react'
import { datasetsApi } from '../api/datasets'
import { imagesApi } from '../api/images'
import { useAppStore } from '../store'

const PREVIEW_PAGE_SIZE = 20

export default function UploadPage() {
  const qc = useQueryClient()
  const { selectedDataset, setSelectedDataset } = useAppStore()
  const [newName, setNewName]   = useState('')
  const [newDesc, setNewDesc]   = useState('')
  const [tab, setTab]           = useState<'images' | 'zip' | 'annotated' | 'roboflow'>('images')
  const [annotatedFormat, setAnnotatedFormat] = useState<'auto' | 'coco' | 'yolo'>('auto')
  const [progress, setProgress] = useState(0)
  const [previewPage, setPreviewPage] = useState(0)

  // Roboflow 폼 상태
  const [rfApiKey,    setRfApiKey]    = useState('')
  const [rfWorkspace, setRfWorkspace] = useState('')
  const [rfProject,   setRfProject]   = useState('')
  const [rfVersion,   setRfVersion]   = useState('1')
  const [showApiKey,  setShowApiKey]  = useState(false)

  const { data: datasetsData } = useQuery({ queryKey: ['datasets'], queryFn: datasetsApi.list })

  const handleSelectDataset = (ds: typeof selectedDataset) => {
    setSelectedDataset(ds!)
    setPreviewPage(0)
  }

  const createDs = useMutation({
    mutationFn: () => datasetsApi.create({ name: newName, description: newDesc }),
    onSuccess: (ds) => {
      handleSelectDataset(ds)
      qc.invalidateQueries({ queryKey: ['datasets'] })
      toast.success(`데이터셋 '${ds.name}' 생성 완료`)
      setNewName(''); setNewDesc('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) =>
      imagesApi.uploadFiles(selectedDataset!.id, files, setProgress),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      qc.invalidateQueries({ queryKey: ['images-preview', selectedDataset?.id] })
      toast.success(`${res.added}개 추가, ${res.skipped}개 중복 스킵`)
      setProgress(0); setPreviewPage(0)
    },
    onError: (e: Error) => { toast.error(e.message); setProgress(0) },
  })

  const zipMutation = useMutation({
    mutationFn: (file: File) => imagesApi.uploadZip(selectedDataset!.id, file),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      qc.invalidateQueries({ queryKey: ['images-preview', selectedDataset?.id] })
      toast.success(`${res.added}개 추가 완료`)
      setPreviewPage(0)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const annotatedMutation = useMutation({
    mutationFn: (file: File) =>
      imagesApi.uploadZipAnnotated(
        selectedDataset!.id, file,
        annotatedFormat === 'auto' ? undefined : annotatedFormat,
        setProgress,
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      qc.invalidateQueries({ queryKey: ['images-preview', selectedDataset?.id] })
      toast.success(`[${res.format.toUpperCase()}] ${res.added}개 추가, ${res.skipped}개 중복, ${res.errors}개 오류`)
      setProgress(0); setPreviewPage(0)
    },
    onError: (e: Error) => { toast.error(e.message); setProgress(0) },
  })

  const roboflowMutation = useMutation({
    mutationFn: () =>
      imagesApi.importRoboflow(
        selectedDataset!.id,
        rfApiKey, rfWorkspace, rfProject, parseInt(rfVersion) || 1,
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      qc.invalidateQueries({ queryKey: ['images-preview', selectedDataset?.id] })
      toast.success(`[COCO] ${res.added}개 추가, ${res.skipped}개 중복, ${res.errors}개 오류`)
      setPreviewPage(0)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteImageMutation = useMutation({
    mutationFn: (imageId: number) => imagesApi.delete(selectedDataset!.id, imageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      qc.invalidateQueries({ queryKey: ['images-preview', selectedDataset?.id] })
      toast.success('이미지 삭제 완료')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
    accept: tab === 'images'
      ? { 'image/*': ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp'] }
      : { 'application/zip': ['.zip'] },
    multiple: tab === 'images',
    disabled: tab === 'roboflow',
  })

  const handleUpload = () => {
    if (!selectedDataset) return toast.error('데이터셋을 먼저 선택하세요.')
    if (!acceptedFiles.length) return toast.error('파일을 선택하세요.')
    if (tab === 'zip') return zipMutation.mutate(acceptedFiles[0])
    if (tab === 'annotated') return annotatedMutation.mutate(acceptedFiles[0])
    uploadMutation.mutate(acceptedFiles)
  }

  const handleRoboflowImport = () => {
    if (!selectedDataset) return toast.error('데이터셋을 먼저 선택하세요.')
    if (!rfApiKey.trim()) return toast.error('API 키를 입력하세요.')
    if (!rfWorkspace.trim()) return toast.error('Workspace를 입력하세요.')
    if (!rfProject.trim()) return toast.error('Project ID를 입력하세요.')
    roboflowMutation.mutate()
  }

  const { data: imagesData } = useQuery({
    queryKey: ['images-preview', selectedDataset?.id, previewPage],
    queryFn: () =>
      imagesApi.list(selectedDataset!.id, previewPage * PREVIEW_PAGE_SIZE, PREVIEW_PAGE_SIZE),
    enabled: !!selectedDataset,
    placeholderData: (prev) => prev,
  })

  const totalPages = Math.max(1, Math.ceil((imagesData?.total ?? 0) / PREVIEW_PAGE_SIZE))

  const isUploading =
    uploadMutation.isPending || zipMutation.isPending ||
    annotatedMutation.isPending || roboflowMutation.isPending

  return (
    <div>
      <h1 className="page-header">📁 데이터셋 업로드</h1>
      <p className="page-subtitle">로컬 이미지를 업로드하거나 Roboflow에서 가져옵니다.</p>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* 새 데이터셋 생성 */}
        <div className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <FolderPlus className="w-4 h-4" /> 새 데이터셋 생성
          </h2>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="데이터셋 이름"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="설명 (선택)"
            rows={2}
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
          />
          <button
            onClick={() => createDs.mutate()}
            disabled={!newName.trim() || createDs.isPending}
            className="btn-primary w-full disabled:opacity-50"
          >
            {createDs.isPending ? '생성 중...' : '데이터셋 생성'}
          </button>
        </div>

        {/* 기존 데이터셋 선택 */}
        <div className="card p-5">
          <h2 className="font-semibold mb-3">기존 데이터셋 선택</h2>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {datasetsData?.items.map(ds => (
              <button
                key={ds.id}
                onClick={() => handleSelectDataset(ds)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedDataset?.id === ds.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <div className="font-medium">{ds.name}</div>
                <div className={`text-xs ${selectedDataset?.id === ds.id ? 'text-blue-100' : 'text-gray-400'}`}>
                  이미지 {ds.image_count}개
                </div>
              </button>
            ))}
          </div>
          {selectedDataset && (
            <p className="text-xs text-blue-600 mt-2 font-medium">✓ 선택됨: {selectedDataset.name}</p>
          )}
        </div>
      </div>

      {/* 업로드 영역 */}
      <div className="card p-5 mb-6">
        {/* 탭 */}
        <div className="flex gap-4 mb-4 border-b">
          {([
            { key: 'images',    label: '이미지 파일' },
            { key: 'zip',       label: 'ZIP (이미지만)' },
            { key: 'annotated', label: 'ZIP (어노테이션 포함)' },
            { key: 'roboflow',  label: '🔗 Roboflow' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 어노테이션 ZIP 옵션 */}
        {tab === 'annotated' && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 rounded-lg text-sm">
            <span className="text-gray-600 font-medium shrink-0">형식 감지:</span>
            {(['auto', 'coco', 'yolo'] as const).map(f => (
              <label key={f} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio" name="annotated-format" value={f}
                  checked={annotatedFormat === f}
                  onChange={() => setAnnotatedFormat(f)}
                  className="accent-blue-600"
                />
                <span className="text-gray-700">{f === 'auto' ? '자동 감지' : f.toUpperCase()}</span>
              </label>
            ))}
            <span className="text-xs text-gray-400 ml-auto">COCO JSON / YOLO 지원</span>
          </div>
        )}

        {/* Roboflow 탭 */}
        {tab === 'roboflow' ? (
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              Roboflow API 키는 <strong>roboflow.com → Settings → Roboflow API</strong>에서 확인하세요.
              다운로드 후 COCO 형식으로 자동 가져옵니다.
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* API Key */}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    className="w-full border rounded-lg px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="rf_xxxxxxxxxxxxxxxxxx"
                    value={rfApiKey}
                    onChange={e => setRfApiKey(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Workspace */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Workspace</label>
                <input
                  type="text"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="my-workspace"
                  value={rfWorkspace}
                  onChange={e => setRfWorkspace(e.target.value)}
                />
              </div>

              {/* Project ID */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Project ID</label>
                <input
                  type="text"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="my-project"
                  value={rfProject}
                  onChange={e => setRfProject(e.target.value)}
                />
              </div>

              {/* Version */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">버전</label>
                <input
                  type="number" min="1"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={rfVersion}
                  onChange={e => setRfVersion(e.target.value)}
                />
              </div>
            </div>

            <button
              onClick={handleRoboflowImport}
              disabled={roboflowMutation.isPending || !selectedDataset}
              className="w-full py-2.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
            >
              <UploadIcon className="w-4 h-4" />
              {roboflowMutation.isPending ? '다운로드 및 가져오기 중…' : 'Roboflow에서 가져오기'}
            </button>
          </div>
        ) : (
          <>
            {/* 파일 드롭존 */}
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
              }`}
            >
              <input {...getInputProps()} />
              <UploadIcon className="w-10 h-10 mx-auto mb-3 text-gray-400" />
              {isDragActive ? (
                <p className="text-blue-500 font-medium">파일을 여기에 놓으세요</p>
              ) : (
                <>
                  <p className="text-gray-600 font-medium mb-1">
                    {tab === 'images' ? '이미지 파일을 드래그하거나 클릭하세요' : 'ZIP 파일을 드래그하거나 클릭하세요'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {tab === 'images' ? 'JPG, PNG, BMP, TIFF, WebP 지원' : '.zip 파일'}
                  </p>
                </>
              )}
              {acceptedFiles.length > 0 && (
                <p className="text-sm text-green-600 mt-2 font-medium">
                  {tab === 'images' ? `${acceptedFiles.length}개 선택됨` : acceptedFiles[0].name}
                </p>
              )}
            </div>

            {/* 진행 바 */}
            {progress > 0 && progress < 100 && (
              <div className="mt-3 w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={isUploading || acceptedFiles.length === 0}
              className="btn-primary w-full mt-4 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <UploadIcon className="w-4 h-4" />
              {isUploading ? '업로드 중...' : '업로드'}
            </button>
          </>
        )}
      </div>

      {/* 이미지 미리보기 */}
      {selectedDataset && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              이미지 목록
              <span className="text-xs text-gray-400 font-normal">({imagesData?.total ?? 0}개)</span>
            </h2>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <button
                  onClick={() => setPreviewPage(p => Math.max(0, p - 1))}
                  disabled={previewPage === 0}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span>{previewPage + 1} / {totalPages}</span>
                <button
                  onClick={() => setPreviewPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={previewPage >= totalPages - 1}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-5 gap-3 sm:grid-cols-8 md:grid-cols-10">
            {imagesData?.items.map(img => (
              <div key={img.id} className="group relative aspect-square rounded-lg overflow-hidden bg-gray-100 border hover:border-gray-300 transition-colors">
                <img
                  src={imagesApi.getFileUrl(selectedDataset.id, img.id)}
                  alt={img.filename}
                  className="w-full h-full object-cover"
                  title={img.filename}
                />
                {/* 삭제 버튼 — hover 시 표시 */}
                <button
                  onClick={() => {
                    if (confirm(`'${img.filename}' 을(를) 삭제할까요?\n연결된 주석도 함께 삭제됩니다.`)) {
                      deleteImageMutation.mutate(img.id)
                    }
                  }}
                  disabled={deleteImageMutation.isPending}
                  className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 disabled:opacity-40"
                  title="이미지 삭제"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {imagesData?.items.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">업로드된 이미지가 없습니다.</p>
          )}
        </div>
      )}
    </div>
  )
}
