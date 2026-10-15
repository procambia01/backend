import { scoreOffer, PAID_BONUS_CAP, type ScoreInput } from '@/services/matching.service';

const base: ScoreInput = { amountFit: 1, rateAdvantage: 0, distanceKm: 2, radiusKm: 10, availableNow: true, ownerVerified: true, trustScore: 80, completionRate: 90, responseRate: 90, disputeRate: 0, meetupPreferenceMatch: true, ageHours: 5, boosted: false, featured: false };

describe('matching: paid placement never destroys relevance', () => {
  it('Boost and Featured add a bounded bonus', () => {
    const plain = scoreOffer(base);
    const paid = scoreOffer({ ...base, boosted: true, featured: true });
    expect(plain.paid).toBe(0);
    expect(paid.paid).toBeGreaterThan(0);
    expect(paid.paid).toBeLessThanOrEqual(PAID_BONUS_CAP);
    expect(paid.organic).toBe(plain.organic);
  });
  it('a clearly better organic match beats a paid but poor one', () => {
    const good = scoreOffer({ ...base });
    const poorPaid = scoreOffer({ ...base, boosted: true, featured: true, trustScore: 10, completionRate: 20, responseRate: 10, ownerVerified: false, disputeRate: 0.4, distanceKm: 40, amountFit: 0.2, rateAdvantage: -0.05, ageHours: 400, meetupPreferenceMatch: false, availableNow: false });
    expect(good.total).toBeGreaterThan(poorPaid.total);
  });
  it('paid bonus shrinks for irrelevant results', () => {
    const weak = scoreOffer({ ...base, trustScore: 0, completionRate: 0, responseRate: 0, ownerVerified: false, distanceKm: 60, amountFit: 0.1, rateAdvantage: -0.1, ageHours: 500, availableNow: false, meetupPreferenceMatch: false, boosted: true });
    const strong = scoreOffer({ ...base, boosted: true });
    expect(weak.paid).toBeLessThan(strong.paid);
  });
  it('disputes lower the organic score', () => {
    expect(scoreOffer({ ...base, disputeRate: 0.3 }).organic).toBeLessThan(scoreOffer(base).organic);
  });
  it('a better rate ranks higher', () => {
    expect(scoreOffer({ ...base, rateAdvantage: 0.03 }).organic).toBeGreaterThan(scoreOffer({ ...base, rateAdvantage: -0.03 }).organic);
  });
});
