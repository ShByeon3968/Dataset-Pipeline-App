import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Dataset } from '../types'

export interface SplitRatios {
  train: number  // 0-100
  val: number    // 0-100
  test: number   // 0-100 (derived: 100 - train - val, stored for display)
}

interface AppState {
  selectedDataset: Dataset | null
  setSelectedDataset: (ds: Dataset | null) => void

  // Split ratios used for export (only applied to images without a split label)
  splitRatios: SplitRatios
  setSplitRatios: (ratios: SplitRatios) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedDataset: null,
      setSelectedDataset: (ds) => set({ selectedDataset: ds }),

      splitRatios: { train: 70, val: 20, test: 10 },
      setSplitRatios: (ratios) => set({ splitRatios: ratios }),
    }),
    { name: 'dataset-pipeline-store' }
  )
)
