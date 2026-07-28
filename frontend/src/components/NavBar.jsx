import { NavLink } from 'react-router-dom'

const tabs = [
  { to: '/',        label: 'Dashboard',  icon: '📊' },
  { to: '/cards',   label: 'Collection', icon: '🏒' },
  { to: '/add',     label: 'Add Card',   icon: '➕' },
  { to: '/sets',    label: 'Sets',       icon: '📋' },
  { to: '/selling', label: 'Selling',    icon: '🏷️'  },
  { to: '/strategy',label: 'Strategy',   icon: '🎯' },
  { to: '/settings',label: 'Settings',   icon: '⚙️'  },
]

export default function NavBar() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[#1A2E45] border-t border-[#A8DADC]/20 flex z-50">
      {tabs.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center py-2 text-[10px] gap-0.5 transition-colors ` +
            (isActive ? 'text-[#A8DADC]' : 'text-[#94A3B8]')
          }
        >
          <span className="text-xl leading-none">{icon}</span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
