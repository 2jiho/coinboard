// Exchanges send numbers as numbers or as strings. Anything else is not a number.
export function number(value) {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return NaN;
  return Number(value);
}
