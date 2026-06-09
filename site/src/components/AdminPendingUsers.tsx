import { useMemo, useState } from 'react';
import { useProfiles, useSetApproval } from '@/hooks/useProfiles';

export function AdminPendingUsers() {
  const profilesQ = useProfiles();
  const setApproval = useSetApproval();
  const [showAll, setShowAll] = useState(false);

  const { pending, approved } = useMemo(() => {
    const all = Object.values(profilesQ.data ?? {});
    const sorted = [...all].sort((a, b) => {
      // Most recently created first
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
    return {
      pending: sorted.filter(p => !p.approved),
      approved: sorted.filter(p => p.approved),
    };
  }, [profilesQ.data]);

  if (profilesQ.isLoading) {
    return <div className="admin-pending-empty">loading users…</div>;
  }

  return (
    <div className="admin-pending">
      <div className="admin-pending-header">
        <h3>Pending approvals</h3>
        <span className="admin-pending-count">{pending.length}</span>
      </div>

      {pending.length === 0 ? (
        <div className="admin-pending-empty">No one waiting. ✿</div>
      ) : (
        <div className="admin-pending-list">
          {pending.map(p => (
            <div key={p.user_id} className="admin-pending-row">
              <span className="admin-pending-name">{p.display_name}</span>
              <span className="admin-pending-when">
                {p.created_at
                  ? new Date(p.created_at).toLocaleDateString(undefined, {
                      month: 'short', day: 'numeric',
                    })
                  : ''}
              </span>
              <button
                className="btn btn-primary admin-pending-approve"
                disabled={setApproval.isPending}
                onClick={() => setApproval.mutate({ userId: p.user_id, approved: true })}
              >
                Approve
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        className="btn btn-ghost admin-pending-toggle"
        onClick={() => setShowAll(s => !s)}
      >
        {showAll ? 'Hide approved users' : `Show approved users (${approved.length})`}
      </button>

      {showAll && (
        <div className="admin-pending-list admin-pending-list-approved">
          {approved.map(p => (
            <div key={p.user_id} className="admin-pending-row admin-pending-row-approved">
              <span className="admin-pending-name">{p.display_name}</span>
              <span className="admin-pending-tag">approved</span>
              <button
                className="btn btn-ghost admin-pending-revoke"
                disabled={setApproval.isPending}
                onClick={() => {
                  if (confirm(`Revoke approval for ${p.display_name}? They'll no longer be able to submit predictions.`)) {
                    setApproval.mutate({ userId: p.user_id, approved: false });
                  }
                }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
