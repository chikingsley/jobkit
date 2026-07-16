import type { Compensation, FxData } from "./types";

interface CompensationDisplay {
  primary: string;
  usd: string | null;
  warning: string | null;
}

export function compensationDisplay(
  compensation: Compensation,
  fx: FxData
): CompensationDisplay {
  const rate = compensation.currency
    ? fx.rates[compensation.currency]
    : undefined;
  const low = compensation.amountMin;
  const high = compensation.amountMax;
  const warning =
    compensation.confidence === "conflict"
      ? (compensation.notes[0] ??
        "The listing contains conflicting compensation details.")
      : null;
  if (!(rate && (low || high)) || warning) {
    return { primary: compensation.display, usd: null, warning };
  }

  const lowUsd = low ? Math.round(low / rate) : null;
  const highUsd = high ? Math.round(high / rate) : null;
  const amount =
    lowUsd && highUsd
      ? `$${lowUsd.toLocaleString()}–$${highUsd.toLocaleString()}`
      : `$${(lowUsd ?? highUsd ?? 0).toLocaleString()}`;
  let qualifier = "≈ ";
  if (compensation.qualifier === "up-to") {
    qualifier = "Up to ";
  } else if (compensation.qualifier === "from") {
    qualifier = "From ";
  }
  return {
    primary: compensation.display,
    usd: `${qualifier}${amount} USD${compensation.period ? `/${compensation.period}` : ""}`,
    warning: null,
  };
}

export function monthlyCompensationUsd(compensation: Compensation, fx: FxData) {
  if (
    !(compensation.amountMin && compensation.currency) ||
    compensation.confidence === "conflict" ||
    compensation.qualifier === "up-to"
  ) {
    return;
  }
  const rate = fx.rates[compensation.currency];
  if (!rate) {
    return;
  }
  const usd = compensation.amountMin / rate;
  if (compensation.period === "month") {
    return usd;
  }
  if (compensation.period === "week") {
    return (usd * 52) / 12;
  }
  if (compensation.period === "year") {
    return usd / 12;
  }
}
