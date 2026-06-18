import { describe, it, expect } from 'vitest';
import { scorePrediction } from './scoring';

describe('scorePrediction', () => {
  describe('null/undefined inputs', () => {
    it('returns 0 when prediction is null', () => {
      expect(scorePrediction(null, { team1: 2, team2: 1 }, false)).toBe(0);
    });

    it('returns 0 when actual is null', () => {
      expect(scorePrediction({ team1: 2, team2: 1 }, null, false)).toBe(0);
    });

    it('returns 0 when both are null', () => {
      expect(scorePrediction(null, null, false)).toBe(0);
    });

    it('returns 0 when prediction is undefined', () => {
      expect(scorePrediction(undefined, { team1: 1, team2: 0 }, false)).toBe(0);
    });
  });

  describe('exact score (3 pts)', () => {
    it('awards 3 for exact match', () => {
      expect(scorePrediction({ team1: 2, team2: 1 }, { team1: 2, team2: 1 }, false)).toBe(3);
    });

    it('awards 3 for exact 0-0 draw', () => {
      expect(scorePrediction({ team1: 0, team2: 0 }, { team1: 0, team2: 0 }, false)).toBe(0 + 3);
    });

    it('awards 3 for exact high-scoring match', () => {
      expect(scorePrediction({ team1: 5, team2: 3 }, { team1: 5, team2: 3 }, false)).toBe(3);
    });
  });

  describe('right outcome (1 pt)', () => {
    it('awards 1 for correct team1 win with wrong score', () => {
      expect(scorePrediction({ team1: 3, team2: 0 }, { team1: 1, team2: 0 }, false)).toBe(1);
    });

    it('awards 1 for correct team2 win with wrong score', () => {
      expect(scorePrediction({ team1: 0, team2: 2 }, { team1: 1, team2: 3 }, false)).toBe(1);
    });

    it('awards 1 for correct draw with wrong score', () => {
      expect(scorePrediction({ team1: 1, team2: 1 }, { team1: 2, team2: 2 }, false)).toBe(1);
    });

    it('awards 1 for predicting draw 0-0 when actual is 3-3', () => {
      expect(scorePrediction({ team1: 0, team2: 0 }, { team1: 3, team2: 3 }, false)).toBe(1);
    });
  });

  describe('wrong outcome (0 pts)', () => {
    it('awards 0 for predicting team1 win when team2 wins', () => {
      expect(scorePrediction({ team1: 2, team2: 0 }, { team1: 0, team2: 1 }, false)).toBe(0);
    });

    it('awards 0 for predicting draw when team1 wins', () => {
      expect(scorePrediction({ team1: 1, team2: 1 }, { team1: 2, team2: 0 }, false)).toBe(0);
    });

    it('awards 0 for predicting team2 win when draw', () => {
      expect(scorePrediction({ team1: 0, team2: 3 }, { team1: 1, team2: 1 }, false)).toBe(0);
    });
  });

  describe('knockout advancer bonus (+1)', () => {
    it('awards +1 for correct advancer in KO match', () => {
      // exact score (3) + advancer (1) = 4
      expect(scorePrediction(
        { team1: 1, team2: 1 }, { team1: 1, team2: 1 },
        true, 'Brazil', 'Brazil',
      )).toBe(4);
    });

    it('awards advancer bonus on top of outcome point', () => {
      // right outcome (1) + advancer (1) = 2
      expect(scorePrediction(
        { team1: 0, team2: 0 }, { team1: 2, team2: 2 },
        true, 'Germany', 'Germany',
      )).toBe(2);
    });

    it('does not award advancer bonus when advancer is wrong', () => {
      expect(scorePrediction(
        { team1: 1, team2: 1 }, { team1: 1, team2: 1 },
        true, 'Brazil', 'Argentina',
      )).toBe(3); // exact only, no advancer
    });

    it('does not award advancer bonus in group matches', () => {
      expect(scorePrediction(
        { team1: 1, team2: 1 }, { team1: 1, team2: 1 },
        false, 'Brazil', 'Brazil',
      )).toBe(3); // isKO=false, no bonus
    });

    it('does not award advancer bonus when predAdvancer is null', () => {
      expect(scorePrediction(
        { team1: 1, team2: 1 }, { team1: 1, team2: 1 },
        true, null, 'Brazil',
      )).toBe(3);
    });

    it('does not award advancer bonus when actualAdvancer is null', () => {
      expect(scorePrediction(
        { team1: 1, team2: 1 }, { team1: 1, team2: 1 },
        true, 'Brazil', null,
      )).toBe(3);
    });

    it('awards 0 + 1 when outcome wrong but advancer correct', () => {
      // wrong outcome but got advancer right — still only +1 for advancer
      expect(scorePrediction(
        { team1: 2, team2: 0 }, { team1: 0, team2: 1 },
        true, 'Argentina', 'Argentina',
      )).toBe(1);
    });
  });
});
