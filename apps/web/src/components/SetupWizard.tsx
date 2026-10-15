import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/lib/api";

/** First run: create the first tenant. The database is chosen at setup on the server, never here (ADR 0010). */
export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("Default Tenant");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setNotice("");
    try {
      if (!(await api.listTenants()).tenants.length) await api.createTenant(name, "default");
      onDone();
    } catch (err: any) { setNotice(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Setup</CardTitle>
          <CardDescription>Create your first tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {notice && <Alert variant="destructive"><AlertDescription>{notice}</AlertDescription></Alert>}
            <div className="space-y-2"><Label htmlFor="tn">Tenant name</Label>
              <Input id="tn" required value={name} onChange={(e) => setName(e.target.value)} /></div>
            <Button disabled={busy}>{busy ? "Initializing…" : "Initialize"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
