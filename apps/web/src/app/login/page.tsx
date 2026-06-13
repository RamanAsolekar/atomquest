'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/logo';
import { useAuth } from '@/store/auth-store';
import { UserRole } from '@atom/shared';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuth((s) => s.login);
  const [email, setEmail] = useState('agent@atomvision.dev');
  const [password, setPassword] = useState('Agent@123');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(email, password);
      toast.success(`Welcome back, ${user.name}`);
      router.push(user.role === UserRole.ADMIN ? '/admin' : '/dashboard');
    } catch (err: any) {
      toast.error(err.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  function quickFill(role: 'agent' | 'admin') {
    if (role === 'agent') { setEmail('agent@atomvision.dev'); setPassword('Agent@123'); }
    else { setEmail('admin@atomvision.dev'); setPassword('Admin@123'); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-mesh p-4">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Link href="/"><Logo /></Link></div>
        <Card className="glass">
          <CardContent className="pt-6">
            <h1 className="text-xl font-semibold">Sign in to your dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">Agents and admins. Customers join via invite link.</p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </div>
              <Button type="submit" variant="gradient" className="w-full" disabled={loading}>
                {loading && <Loader2 className="animate-spin" />} Sign in
              </Button>
            </form>
            <div className="mt-6 rounded-lg border border-dashed p-3 text-xs">
              <p className="mb-2 font-medium text-muted-foreground">Demo credentials (click to fill):</p>
              <div className="flex gap-2">
                <button onClick={() => quickFill('agent')} className="flex-1 rounded-md bg-secondary px-2 py-1.5 text-left hover:bg-secondary/70">
                  <span className="font-medium">Agent</span><br /><span className="text-muted-foreground">agent@atomvision.dev</span>
                </button>
                <button onClick={() => quickFill('admin')} className="flex-1 rounded-md bg-secondary px-2 py-1.5 text-left hover:bg-secondary/70">
                  <span className="font-medium">Admin</span><br /><span className="text-muted-foreground">admin@atomvision.dev</span>
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
