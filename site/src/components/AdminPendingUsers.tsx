import { useMemo, useState, useEffect } from 'react';
import { useProfiles, useSetApproval, useDeleteProfile } from '@/hooks/useProfiles';
import { useAllPredictions } from '@/hooks/usePredictions';
import { useResults } from '@/hooks/useResults';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export function AdminPendingUsers() {
  const { user } = useAuth();
  const profilesQ = useProfiles();
  const predsQ = useAllPredictions();
  const resultsQ = useResults();
  const setApproval = useSetApproval();
  const deleteProfile = useDeleteProfile();
  const [showAll, setShowAll] = useState(false);
  const [capsuleCount, setCapsuleCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { count } = await supabase
        .from('wc26_time_capsule')
        .select('*', { count: 'exact', head: true });
      setCapsuleCount(count);
    })();
  }, []);

  const { pending, approved, myProfile } = useMemo(() => {
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
      myProfile: user ? profilesQ.data?.[user.id] : undefined,
    };
  }, [profilesQ.data, user]);

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
                disabled={setApproval.isPending || deleteProfile.isPending}
                onClick={() => setApproval.mutate({ userId: p.user_id, approved: true })}
              >
                Approve
              </button>
              <button
                className="btn btn-ghost admin-pending-decline"
                disabled={setApproval.isPending || deleteProfile.isPending}
                onClick={() => {
                  if (confirm(`Decline ${p.display_name}? This removes them from the league. They can't sign back in with the same email.`)) {
                    deleteProfile.mutate(p.user_id);
                  }
                }}
                title="Reject this signup"
              >
                Decline
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

      {/* Diagnostic snapshot — helps debug missing-from-leaderboard cases. */}
      <div className="admin-diag">
        <div className="admin-diag-row">
          <span>Your profile</span>
          <strong>
            {!myProfile
              ? '⚠ MISSING — not in wc26_profiles'
              : myProfile.approved ? '✓ approved' : '⚠ NOT approved'}
          </strong>
        </div>
        <div className="admin-diag-row">
          <span>Profiles · approved / total</span>
          <strong>{approved.length} / {(approved.length + pending.length)}</strong>
        </div>
        <div className="admin-diag-row">
          <span>Predictions stored</span>
          <strong>{predsQ.data?.length ?? '—'}</strong>
        </div>
        <div className="admin-diag-row">
          <span>Actual results stored</span>
          <strong>{Object.keys(resultsQ.data ?? {}).length}</strong>
        </div>
        <div className="admin-diag-row">
          <span>Time Capsules sealed</span>
          <strong>{capsuleCount ?? '—'} / {approved.length}</strong>
        </div>
      </div>
    </div>
  );
}
