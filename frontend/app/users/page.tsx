"use client";

import { useEffect, useState } from "react";
import { Check, X, RotateCcw, ShieldAlert } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Th, Td, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { User } from "@/lib/types";

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" },
  { key: "rejected", label: "Rejected" },
] as const;

function UsersBody() {
  const { user: me } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pending");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setUsers(await api.users.list(tab));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const isOwner = me?.role === "owner";

  const act = async (fn: () => Promise<User>, id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed — try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Access Control"
        title="User Management"
        caption="Approve, reject, suspend or reactivate accounts. Both roles get identical access once active — role is informational only."
      />

      {!isOwner && (
        <Panel className="!mb-5 flex items-center gap-2 !py-3.5 bg-amber-50 border-amber-200">
          <ShieldAlert size={15} className="text-brand-amber shrink-0" />
          <span className="font-body text-[13px] text-ink">
            Only an Owner can approve, reject, suspend or reactivate accounts.
          </span>
        </Panel>
      )}

      <div className="flex gap-1.5 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`font-body text-[13px] px-3.5 py-2 rounded-md border cursor-pointer ${
              tab === t.key ? "bg-ink text-white border-ink" : "bg-white text-ink border-hairline"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="font-body text-xs text-brand-red mb-3">{error}</div>}

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Requested</Th>
                {tab === "active" && <Th>Approved</Th>}
                {isOwner && <Th center>Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><Td colSpan={isOwner ? 6 : 5} center>Loading…</Td></tr>
              ) : users.length === 0 ? (
                <tr><Td colSpan={isOwner ? 6 : 5} center color="#8E8E93">No {tab} users.</Td></tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id}>
                    <Td bold>{u.name}</Td>
                    <Td mono>{u.email}</Td>
                    <Td mono>{u.role === "owner" ? "Owner" : "Staff"}</Td>
                    <Td mono>{fmtTime(u.created_at)}</Td>
                    {tab === "active" && <Td mono>{u.approved_at ? fmtTime(u.approved_at) : "—"}</Td>}
                    {isOwner && (
                      <Td center>
                        <div className="flex items-center justify-center gap-1.5">
                          {tab === "pending" && (
                            <>
                              <Button
                                variant="teal"
                                disabled={busyId === u.id}
                                onClick={() => act(() => api.users.approve(u.id, "staff"), u.id)}
                              >
                                <Check size={13} /> Approve
                              </Button>
                              <Button
                                variant="outline"
                                disabled={busyId === u.id}
                                onClick={() => act(() => api.users.reject(u.id), u.id)}
                              >
                                <X size={13} /> Reject
                              </Button>
                            </>
                          )}
                          {tab === "active" && u.id !== me?.id && (
                            <Button
                              variant="outline"
                              disabled={busyId === u.id}
                              onClick={() => act(() => api.users.suspend(u.id), u.id)}
                            >
                              <X size={13} /> Suspend
                            </Button>
                          )}
                          {tab === "suspended" && (
                            <Button
                              variant="teal"
                              disabled={busyId === u.id}
                              onClick={() => act(() => api.users.reactivate(u.id), u.id)}
                            >
                              <RotateCcw size={13} /> Reactivate
                            </Button>
                          )}
                          {tab === "rejected" && (
                            <Button
                              variant="teal"
                              disabled={busyId === u.id}
                              onClick={() => act(() => api.users.approve(u.id, "staff"), u.id)}
                            >
                              <Check size={13} /> Approve
                            </Button>
                          )}
                        </div>
                      </Td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export default function UsersPage() {
  return (
    <AuthGate>
      <UsersBody />
    </AuthGate>
  );
}
