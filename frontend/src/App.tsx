import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import Home from './pages/Home'
import Upload from './pages/Upload'
import Labeling from './pages/Labeling'
import Analysis from './pages/Analysis'
import Refinement from './pages/Refinement'
import Ontology from './pages/Ontology'
import Export from './pages/Export'
import Versioning from './pages/Versioning'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="upload" element={<Upload />} />
          <Route path="labeling" element={<Labeling />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="refinement" element={<Refinement />} />
          <Route path="ontology" element={<Ontology />} />
          <Route path="export" element={<Export />} />
          <Route path="versioning" element={<Versioning />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
