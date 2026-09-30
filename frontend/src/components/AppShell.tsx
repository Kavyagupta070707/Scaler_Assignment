"use client";

import { CalendarDays, ChevronDown, Clock3, Home, MessageSquare, Search, Settings, Users, Video } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Home", icon: Home },
  { href: "/", label: "Team Chat", icon: MessageSquare },
  { href: "/", label: "Meetings", icon: Video },
  { href: "/", label: "Contacts", icon: Users },
  { href: "/", label: "Calendar", icon: CalendarDays },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Zoomly home">
          <span className="brand-mark"><Video size={22} fill="currentColor" /></span>
          <span>zoomly</span>
        </Link>
        <nav className="side-nav">
          {items.map(({ href, label, icon: Icon }, index) => (
            <Link className={`side-item ${index === 0 && pathname === "/" ? "active" : ""}`} href={href} key={label}>
              <Icon size={20} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="side-footer">
          <Link className="side-item" href="/"><Settings size={20} /><span>Settings</span></Link>
        </div>
      </aside>
      <div className="app-column">
        <header className="topbar">
          <div className="mobile-brand">zoomly</div>
          <label className="search-box">
            <Search size={17} />
            <input aria-label="Search" placeholder="Search" />
            <kbd>Ctrl K</kbd>
          </label>
          <div className="top-actions">
            <button className="icon-button notification" aria-label="Meeting history"><Clock3 size={19} /></button>
            <button className="profile-button"><span className="avatar">KG</span><span className="profile-copy"><strong>Kavya Gupta</strong><small>Available</small></span><ChevronDown size={15} /></button>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}

