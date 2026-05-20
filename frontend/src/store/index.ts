import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Dataset } from '../types'

interface AppState {
  selectedDataset: Dataset | null
  setSelectedDataset: (ds: Dataset | null) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedDataset: null,
      setSelectedDataset: (ds) => set({ selectedDataset: ds }),
    }),
    { name: 'dataset-pipeline-store' }
  )
)
