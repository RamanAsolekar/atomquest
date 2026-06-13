'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, History, BarChart3, Shield, Settings,
  LogOut, ScrollText, SlidersHorizontal,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/store/auth-store';
import { cn, initials } from '@/lib/utils';
import { UserRole } from '@atom/shared';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [UserRole.AGENT, UserRole.ADMIN] },
  { href: '/history', label: 'History', icon: History, roles: [UserRole.AGENT, UserRole.ADMIN] },
  { href: '/analytics', label: 'Analytics', icon: BarChart3, roles: [UserRole.AGENT, UserRole.ADMIN] },
  { href: '/admin', label: 'Admin', icon: Shield, roles: [UserRole.ADMIN] },
  { href: '/admin/config', label: 'Config & KB', icon: SlidersHorizontal, roles: [UserRole.ADMIN] },
  { href: '/admin/audit', label: 'Audit Logs', icon: ScrollText, roles: [UserRole.ADMIN] },
  { href: '/settings', label: 'Settings', icon: Settings, roles: [UserRole.AGENT, UserRole.ADMIN] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>
    );
  }
  if (!user) return null;

  const visibleNav = nav.filter((n) => n.roles.includes(user.role));

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card/40 p-4 md:flex">
        <Link href="/dashboard" className="mb-8 px-2"><Logo /></Link>
        <nav className="flex-1 space-y-1">
          {visibleNav.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-4 rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <Avatar><AvatarImage src={user.avatarUrl ?? undefined} /><AvatarFallback>{initials(user.name)}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground capitalize">{user.role.toLowerCase()}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start text-muted-foreground" onClick={async () => { await logout(); router.push('/login'); }}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
