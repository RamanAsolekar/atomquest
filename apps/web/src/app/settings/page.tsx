'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun, Monitor, User, Shield, Bell } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/store/auth-store';
import { initials } from '@/lib/utils';

export default function SettingsPage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  if (!user) return null;

  return (
    <AppShell>
      <div className="h-screen overflow-y-auto">
        <div className="container max-w-3xl py-8">
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your profile and preferences.</p>

          <Card className="mt-6"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><User className="h-4 w-4" />Profile</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16"><AvatarImage src={user.avatarUrl ?? undefined} /><AvatarFallback className="text-lg">{initials(user.name)}</AvatarFallback></Avatar>
                <div><p className="font-medium">{user.name}</p><p className="text-sm text-muted-foreground">{user.email}</p><Badge className="mt-1 capitalize">{user.role.toLowerCase()}</Badge></div>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sun className="h-4 w-4" />Appearance</CardTitle><CardDescription>Choose how Atom Support Vision looks to you.</CardDescription></CardHeader>
            <CardContent>
              <div className="flex gap-2">
                {[['light', Sun], ['dark', Moon], ['system', Monitor]].map(([t, Icon]: any) => (
                  <Button key={t} variant={theme === t ? 'default' : 'outline'} onClick={() => setTheme(t)} className="capitalize"><Icon className="h-4 w-4" />{t}</Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4" />Security</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p className="flex items-center justify-between"><span>JWT access token</span><Badge variant="success">Active</Badge></p>
              <p className="flex items-center justify-between"><span>Refresh token (httpOnly cookie)</span><Badge variant="success">Rotating</Badge></p>
              <p className="flex items-center justify-between"><span>Role-based access control</span><Badge variant="success">Enforced</Badge></p>
            </CardContent>
          </Card>

          <Card className="mt-4"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4" />Notifications</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">In-app toasts are enabled for session events, recordings and reconnections.</p></CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
