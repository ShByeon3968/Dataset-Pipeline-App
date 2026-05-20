import { NavLink } from 'react-router-dom'
import {
  Upload, Tag, BarChart2, Scissors, GitMerge, Download, Home, Target, GitBranch,
} from 'lucide-react'
import clsx from 'clsx'

const navItems = [
  { to: '/', icon: Home, label: '홈', exact: true },
  { to: '/upload', icon: Upload, label: '1. 업로드' },
  { to: '/labeling', icon: Tag, label: '2. 레이블링' },
  { to: '/analysis', icon: BarChart2, label: '3. 분석' },
  { to: '/refinement', icon: Scissors, label: '4. 정제' },
  { to: '/ontology', icon: GitMerge, label: '5. 온톨로지' },
  { to: '/export', icon: Download, label: '6. 내보내기' },
  { to: '/versioning', icon: GitBranch, label: '7. 버저닝' },
]

export default function Sidebar() {
  return (
    <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Target className="w-6 h-6 text-blue-400" />
          <span className="font-bold text-sm leading-tight">
            데이터셋<br />
            <span className="font-normal text-gray-300">관리 솔루션</span>
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3">
        {navItems.map(({ to, icon: Icon, label, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              )
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500">
        v1.0.0 FastAPI + React
      </div>
    </aside>
  )
}
