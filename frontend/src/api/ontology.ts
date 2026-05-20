import client from './client'
import type { OntologyRule, OntologyHistory } from '../types'

export const ontologyApi = {
  mapClasses: (
    datasetId: number,
    sourceClassIds: number[],
    targetClassName: string,
    saveAsRule = false,
    ruleName?: string,
  ) =>
    client.post(`/datasets/${datasetId}/ontology/map`, {
      dataset_id: datasetId,
      source_class_ids: sourceClassIds,
      target_class_name: targetClassName,
      save_as_rule: saveAsRule,
      rule_name: ruleName,
    }).then(r => r.data),

  history: (datasetId: number) =>
    client.get<OntologyHistory[]>(`/datasets/${datasetId}/ontology/history`).then(r => r.data),

  undo: (datasetId: number, historyId: number) =>
    client.post(`/datasets/${datasetId}/ontology/history/${historyId}/undo`).then(r => r.data),

  // 규칙
  listRules: () => client.get<OntologyRule[]>('/ontology/rules').then(r => r.data),
  createRule: (data: { name: string; description: string; sources: string[]; target: string }) =>
    client.post<OntologyRule>('/ontology/rules', data).then(r => r.data),
  deleteRule: (ruleId: number) => client.delete(`/ontology/rules/${ruleId}`),
}
