import { Outlet, NavLink } from 'react-router-dom'
import {
  FiHome,
  FiFolder,
  FiZap,
  FiShare2,
  FiActivity,
  FiSettings
} from 'react-icons/fi'
import clsx from 'clsx'

const navItems = [
  { to: '/dashboard', icon: FiHome, label: 'Dashboard' },
  { to: '/projects', icon: FiFolder, label: 'Projects' },
  { to: '/hypotheses', icon: FiZap, label: 'Hypotheses' },
  { to: '/knowledge', icon: FiShare2, label: 'Knowledge Graph' },
  { to: '/simulations', icon: FiActivity, label: 'Simulations' },
]

export default function Layout() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-secondary-900 border-r border-secondary-700 flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-secondary-700">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">G</span>
            </div>
            <span className="text-xl font-semibold text-white">GenUp</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors duration-200',
                  isActive
                    ? 'bg-primary-600/20 text-primary-400'
                    : 'text-secondary-400 hover:bg-secondary-800 hover:text-secondary-100'
                )
              }
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="p-4 border-t border-secondary-700">
          <NavLink
            to="/settings"
            className="flex items-center space-x-3 px-4 py-3 rounded-lg text-secondary-400 hover:bg-secondary-800 hover:text-secondary-100 transition-colors duration-200"
          >
            <FiSettings className="w-5 h-5" />
            <span className="font-medium">Settings</span>
          </NavLink>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-secondary-950">
        <Outlet />
      </main>
    </div>
  )
}
