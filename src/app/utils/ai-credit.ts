export interface CreditPricingPlan {
  tokenAmount?: number;
  priceGbpPence?: number;
}

export const FALLBACK_PENCE_PER_TOKEN = 799 / 100000;

export function pencePerTokenFromPlans(plans: CreditPricingPlan[] | null | undefined): number {
  const pricedPlans = (plans ?? []).filter(
    (plan) => (plan.tokenAmount ?? 0) > 0 && (plan.priceGbpPence ?? 0) > 0,
  );
  if (pricedPlans.length === 0) return FALLBACK_PENCE_PER_TOKEN;

  const totalTokens = pricedPlans.reduce((sum, plan) => sum + (plan.tokenAmount ?? 0), 0);
  const totalPence = pricedPlans.reduce((sum, plan) => sum + (plan.priceGbpPence ?? 0), 0);
  return totalTokens > 0 ? totalPence / totalTokens : FALLBACK_PENCE_PER_TOKEN;
}

export function tokensToGbpPence(tokens: number | null | undefined, pencePerToken = FALLBACK_PENCE_PER_TOKEN): number {
  return Math.round((tokens ?? 0) * pencePerToken);
}

export function formatGbpPence(pence: number | null | undefined, options: { sign?: boolean } = {}): string {
  const value = pence ?? 0;
  const prefix = options.sign && value > 0 ? '+' : '';
  const negative = value < 0 ? '-' : '';
  return `${prefix}${negative}£${(Math.abs(value) / 100).toFixed(2)}`;
}
