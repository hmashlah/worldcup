import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface Capsule {
  user_id: string;
  winner: string;
  top_scorer: string | null;
  dark_horse: string | null;
  bold_take: string | null;
  sealed_at: string;
}

// Tournament final date — capsules are revealed after this
const REVEAL_DATE = new Date('2026-07-19T20:00:00Z');
// Capsule deadline — must seal before knockout stage begins
const DEADLINE = new Date('2026-06-28T00:00:00Z');

export function useTimeCapsule() {
  const { user } = useAuth();
  const [myCapsule, setMyCapsule] = useState<Capsule | null | undefined>(undefined); // undefined = loading
  const [allCapsules, setAllCapsules] = useState<Capsule[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Check if user already sealed a capsule
      const { data } = await supabase
        .from('wc26_time_capsule')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      setMyCapsule((data as Capsule | null) ?? null);
      // Only prompt if no capsule AND before deadline
      if (!data && Date.now() < DEADLINE.getTime()) setShowPrompt(true);
    })();
  }, [user]);

  // Load all capsules (for reveal page)
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('wc26_time_capsule')
        .select('*');
      setAllCapsules((data as Capsule[]) ?? []);
    })();
  }, [user]);

  const isRevealed = Date.now() > REVEAL_DATE.getTime();
  const isExpired = Date.now() >= DEADLINE.getTime();

  return { myCapsule, allCapsules, showPrompt, setShowPrompt, isRevealed, isExpired };
}

interface Props {
  onClose: () => void;
}

export function TimeCapsuleModal({ onClose }: Props) {
  const { user } = useAuth();
  const [winner, setWinner] = useState('');
  const [topScorer, setTopScorer] = useState('');
  const [darkHorse, setDarkHorse] = useState('');
  const [boldTake, setBoldTake] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSeal = async () => {
    if (!user || !winner.trim()) return;
    setSaving(true);
    await supabase.from('wc26_time_capsule').insert({
      user_id: user.id,
      winner: winner.trim(),
      top_scorer: topScorer.trim() || null,
      dark_horse: darkHorse.trim() || null,
      bold_take: boldTake.trim() || null,
    });
    setSaving(false);
    setSaved(true);
  };

  if (saved) {
    return (
      <div className="gc-modal-overlay" onClick={onClose}>
        <div className="gc-modal capsule-modal" onClick={e => e.stopPropagation()}>
          <div className="capsule-sealed">
            <div className="capsule-icon">🔒</div>
            <h3>Time Capsule Sealed!</h3>
            <p>Your predictions are locked away until the final on July 19th. No peeking!</p>
            <button type="button" className="btn btn-primary" onClick={onClose}>Got it</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gc-modal-overlay" onClick={onClose}>
      <div className="gc-modal capsule-modal" onClick={e => e.stopPropagation()}>
        <div className="gc-modal-header">
          <h3>🏆 Time Capsule</h3>
          <button type="button" className="gc-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="capsule-body">
          <p className="capsule-intro">
            Seal your bold predictions now — they'll be revealed after the final. No edits, no take-backs!
          </p>

          <label className="capsule-label">
            Who wins it all? <span className="capsule-required">*</span>
            <input
              className="capsule-input"
              value={winner}
              onChange={e => setWinner(e.target.value)}
              placeholder="e.g. Argentina"
            />
          </label>

          <label className="capsule-label">
            Top scorer?
            <input
              className="capsule-input"
              value={topScorer}
              onChange={e => setTopScorer(e.target.value)}
              placeholder="e.g. Mbappé"
            />
          </label>

          <label className="capsule-label">
            Dark horse team?
            <input
              className="capsule-input"
              value={darkHorse}
              onChange={e => setDarkHorse(e.target.value)}
              placeholder="e.g. Nigeria"
            />
          </label>

          <label className="capsule-label">
            Your bold take
            <input
              className="capsule-input"
              value={boldTake}
              onChange={e => setBoldTake(e.target.value)}
              placeholder="e.g. Germany won't make it past groups"
            />
          </label>

          <button
            type="button"
            className="capsule-seal-btn"
            onClick={handleSeal}
            disabled={saving || !winner.trim()}
          >
            {saving ? 'Sealing…' : '🔒 Seal My Capsule'}
          </button>
        </div>
      </div>
    </div>
  );
}
