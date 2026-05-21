// ── 공통 타입 정의 ──────────────────────────────────────────

export interface Dataset {
  id: number
  name: string
  description: string
  source: 'local' | 'roboflow'
  created_at: string
  updated_at: string
  image_count: number
  annotation_count: number
  class_count: number
}

export interface DatasetCreate {
  name: string
  description?: string
  source?: string
}

export interface Image {
  id: number
  dataset_id: number
  filename: string
  filepath: string
  width: number | null
  height: number | null
  format: string | null
  file_hash: string | null
  phash: string | null
  created_at: string
  annotations: Annotation[]
}

export interface Annotation {
  id: number
  image_id: number
  class_id: number | null
  class_name: string | null
  class_color: string | null
  bbox_x: number | null
  bbox_y: number | null
  bbox_w: number | null
  bbox_h: number | null
  segmentation: number[][] | null
  annotation_type: 'bbox' | 'polygon'
  is_auto_generated: boolean
  confidence: number | null
  created_at: string
  updated_at: string
}

export interface AnnotationCreate {
  image_id: number
  class_id?: number | null
  bbox_x?: number
  bbox_y?: number
  bbox_w?: number
  bbox_h?: number
  segmentation?: number[][] | null
  annotation_type?: string
}

export interface Class {
  id: number
  dataset_id: number
  name: string
  color: string
  created_at: string
}

export interface OntologyRule {
  id: number
  name: string
  description: string
  rule_data: { sources: string[]; target: string }
  created_at: string
}

export interface OntologyHistory {
  id: number
  dataset_id: number
  action: string | null
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  created_at: string
}

// Analysis types
export interface ClassDistribution {
  name: string
  color: string
  count: number
}

export interface BboxStats {
  count: number
  width: number[]
  height: number[]
  area: number[]
  width_stats: { min: number; max: number; mean: number; median: number; std: number }
  height_stats: { min: number; max: number; mean: number; median: number; std: number }
  area_stats: { min: number; max: number; mean: number; median: number; std: number }
}

export interface DatasetSummary {
  image_count: number
  annotation_count: number
  class_count: number
  unlabeled_count: number
  avg_annotations_per_image: number
}

// Refinement types
export interface DuplicateImageMeta {
  id: number
  filename: string
  phash: string | null
  file_hash: string | null
  width: number | null
  height: number | null
  format: string | null
  created_at: string | null
}

export interface DuplicateGroup {
  phash?: string
  file_hash?: string
  images: DuplicateImageMeta[]
  count: number
}

export interface LabelError {
  annotation_id: number
  image_id: number
  image_filename: string
  issue: string
  confidence: number
  detail: Record<string, number | string> | null
}

// ── Versioning & Lineage ──────────────────────────────────────

export interface ClassDistItem {
  name: string
  count: number
}

export interface DatasetVersion {
  id: number
  dataset_id: number
  version_name: string
  description: string
  created_by: string
  created_at: string
  parent_version_id: number | null
  branch_name: string
  image_count: number
  annotation_count: number
  class_count: number
  added_images: number
  deleted_images: number
  modified_labels: number
  class_distribution: ClassDistItem[]
  image_ids_hash: string
  tags: string
}

export interface DatasetVersionCreate {
  version_name: string
  description?: string
  created_by?: string
  branch_name?: string
  parent_version_id?: number | null
  tags?: string
}

export interface ModelVersion {
  id: number
  name: string
  description: string
  framework: string
  trained_at: string | null
  created_at: string
  created_by: string
}

export interface ModelVersionCreate {
  name: string
  description?: string
  framework?: string
  trained_at?: string | null
  created_by?: string
}

export interface ModelDatasetLink {
  id: number
  model_version_id: number
  dataset_version_id: number
  dataset_id: number
  linked_at: string
  linked_by: string
  note: string
  is_active: boolean
}

export interface LineageNode {
  id: number
  type: 'dataset_version' | 'model_version'
  label: string
  dataset_id?: number
  version_name?: string
  branch_name?: string
  framework?: string
  created_at: string
}

export interface LineageEdge {
  source: number
  source_type: string
  target: number
  target_type: string
  label: string
}

export interface LineageGraph {
  nodes: LineageNode[]
  edges: LineageEdge[]
}
