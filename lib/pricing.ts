import type { LineItem, Opening, Quote, QuoteOpening, Series } from "@/lib/types";

/**
 * The price book, and the arithmetic that turns an opening into money.
 *
 * These are the marketing site's estimator rates, so a quote written here and
 * the number a visitor is shown on thehydrodam.com cannot disagree. They are
 * still provisional — Mady has not confirmed a final $/sqft — which is why they
 * live in one place rather than being sprinkled through the UI.
 *
 * The same figures are seeded into `products` for the record; this module is
 * what actually prices a quote.
 */

export const SERIES_RATE_PER_SQFT_CENTS: Record<Series, number> = {
  sentinel: 5800,
  onyx: 7200,
  titanium: 9600,
};

export const POST_COST_EACH_CENTS = 24000;
export const INSTALL_PER_OPENING_CENTS = 18500;
export const DEPLOY_KIT_PER_OPENING_CENTS = 9500;

/** Effective coverage per plank, in inches. Not the plank's physical height. */
export const PANEL_HEIGHT_IN = 7.08;

/** Anything wider than 9 ft takes a third, centre post. */
export const CENTER_POST_WIDTH_IN = 108;

export const panelCountFor = (heightIn: number): number =>
  Math.max(1, Math.ceil(heightIn / PANEL_HEIGHT_IN));

export const postCountFor = (widthIn: number): number => (widthIn > CENTER_POST_WIDTH_IN ? 3 : 2);

export function priceOpening(widthIn: number, heightIn: number, series: string, qty: number): number {
  const sqft = (widthIn * heightIn) / 144;
  const rate = SERIES_RATE_PER_SQFT_CENTS[series as Series] ?? SERIES_RATE_PER_SQFT_CENTS.sentinel;
  return Math.round(
    (sqft * rate + postCountFor(widthIn) * POST_COST_EACH_CENTS + DEPLOY_KIT_PER_OPENING_CENTS) * qty
  );
}

export type OpeningSpec = {
  openingId?: string;
  label: string;
  type: Opening["type"];
  widthIn: number;
  protectionHeightIn: number;
  quantity: number;
  series: Series;
};

export const specFor = (o: Opening, series: Series): OpeningSpec => ({
  openingId: o.id,
  label: o.label,
  type: o.type,
  widthIn: o.widthIn,
  protectionHeightIn: o.protectionHeightIn,
  quantity: 1,
  series,
});

export function priceQuoteOpening(spec: OpeningSpec): Omit<QuoteOpening, "id"> {
  return {
    label: spec.label,
    type: spec.type,
    widthIn: spec.widthIn,
    protectionHeightIn: spec.protectionHeightIn,
    quantity: spec.quantity,
    series: spec.series,
    panelCount: panelCountFor(spec.protectionHeightIn),
    postCount: postCountFor(spec.widthIn),
    centerPostRequired: spec.widthIn > CENTER_POST_WIDTH_IN,
    lineTotalCents: priceOpening(spec.widthIn, spec.protectionHeightIn, spec.series, spec.quantity),
  };
}

/**
 * One priced line per opening, plus labor.
 *
 * Labor is a separate line because it is separately negotiable and because a
 * lump-sum real property improvement carries no sales tax either way — if the
 * company ever moves to the retail regime, the material/labor split is already
 * drawn where the Department of Revenue draws it.
 */
export function lineItemsFor(specs: OpeningSpec[]): Omit<LineItem, "id">[] {
  const items: Omit<LineItem, "id">[] = specs.map((s) => ({
    kind: "material",
    name: `${s.series[0].toUpperCase()}${s.series.slice(1)} barrier — ${s.label}`,
    quantity: 1,
    unit: "each",
    unitPriceCents: priceOpening(s.widthIn, s.protectionHeightIn, s.series, s.quantity),
    unitCostCents: Math.round(priceOpening(s.widthIn, s.protectionHeightIn, s.series, s.quantity) * 0.44),
    taxable: false,
    optional: false,
    selected: true,
  }));

  if (specs.length > 0) {
    items.push({
      kind: "labor",
      name: `Installation labor — ${specs.length} opening${specs.length === 1 ? "" : "s"}`,
      quantity: specs.length,
      unit: "opening",
      unitPriceCents: INSTALL_PER_OPENING_CENTS,
      unitCostCents: 9000,
      taxable: false,
      optional: false,
      selected: true,
    });
  }
  return items;
}

export function quoteTotals(items: Pick<LineItem, "quantity" | "unitPriceCents" | "selected">[], discountCents = 0) {
  const subtotalCents = items
    .filter((i) => i.selected)
    .reduce((s, i) => s + Math.round(i.quantity * i.unitPriceCents), 0);
  // Lump-sum real property improvement: no sales tax to the customer.
  return { subtotalCents, taxCents: 0, totalCents: Math.max(0, subtotalCents - discountCents) };
}

export const depositFor = (totalCents: number, bps: number): number => Math.round((totalCents * bps) / 10000);

export const SERIES: Series[] = ["sentinel", "onyx", "titanium"];

export const seriesLabel = (s: Quote["primarySeries"]): string => `${s[0].toUpperCase()}${s.slice(1)}`;
