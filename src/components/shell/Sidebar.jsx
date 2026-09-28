import Icon from '../../design/Icon.jsx'
import CorranzoMark from './CorranzoMark.jsx'

const PRIMARY_NAV = [
  { view: 'home', label: 'Home', icon: 'home', number: '01' },
  { view: 'library', label: 'Library', icon: 'library', number: '02' },
  { view: 'practice', label: 'Practice', icon: 'practice', number: '03', tourId: 'topbar-practice' },
]
const SECONDARY_NAV = [
  { view: 'profile', label: 'History', icon: 'clock' },
  { view: 'settings', label: 'Settings', icon: 'settings' },
]
const IMPORT_ACTION = { view: 'import', label: 'Import', icon: 'import' }

function NavButton({ item, active, collapsed, onNavigate, utility = false }) {
  return (
    <button
      type="button"
      className={`cz-shell__navbtn${active ? ' cz-shell__navbtn--active' : ''}${utility ? ' cz-shell__navbtn--utility' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      data-label={item.label}
      data-tour-id={item.tourId}
      onClick={() => onNavigate(item.view)}
    >
      {item.number && <span className="cz-shell__navnumber" aria-hidden="true">{item.number}</span>}
      <span className="cz-shell__navicon" aria-hidden="true"><Icon name={item.icon} size={19} /></span>
      <span className="cz-shell__navlabel" aria-hidden={collapsed || undefined}>{item.label}</span>
      {!utility && <span className="cz-shell__nav-indicator" aria-hidden="true" />}
    </button>
  )
}

export default function Sidebar({ activeView, onNavigate, layout = 'expanded', expanded, onToggleExpanded, drawerActive = false }) {
  const collapsed = layout !== 'expanded'
  return (
    <nav className="cz-shell__sidebar" aria-label="Primary" data-sidebar-nav="true" data-collapsed={collapsed}>
      <a href="/" className="cz-shell__brand" aria-label="Corranzo home" onClick={(event) => { event.preventDefault(); onNavigate('home') }}>
        <span className="cz-shell__mark"><CorranzoMark /></span>
        {!collapsed && <span className="cz-shell__wordmark">corranzo</span>}
      </a>
      <div className="cz-shell__navgroup">
        {!collapsed && <p className="cz-shell__navcaption">The practice room</p>}
        {PRIMARY_NAV.map((item) => <NavButton key={item.view} item={item} active={activeView === item.view} collapsed={collapsed} onNavigate={onNavigate} />)}
      </div>
      <div className="cz-shell__navgroup cz-shell__navgroup--action">
        <NavButton item={IMPORT_ACTION} active={activeView === 'import'} collapsed={collapsed} onNavigate={onNavigate} utility />
      </div>
      <div className="cz-shell__sidefooter">
        <div className="cz-shell__navgroup cz-shell__navgroup--secondary">
          {SECONDARY_NAV.map((item) => <NavButton key={item.view} item={item} active={activeView === item.view} collapsed={collapsed} onNavigate={onNavigate} utility />)}
        </div>
        <button type="button" className="cz-shell__navbtn cz-shell__navbtn--utility cz-shell__collapse" onClick={onToggleExpanded} aria-label={drawerActive ? 'Close navigation' : expanded ? 'Collapse sidebar' : 'Expand sidebar'} title={drawerActive ? 'Close navigation' : expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
          <Icon name={drawerActive ? 'close' : 'panel'} size={18} />
          {!collapsed && <span>{drawerActive ? 'Close navigation' : 'Collapse'}</span>}
        </button>
      </div>
    </nav>
  )
}
