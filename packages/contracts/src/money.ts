export function exact(value: string, scale: number): number {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(value))
    throw Error("Use a nonnegative exact decimal");
  const [whole, fraction = ""] = value.split(".");
  const n =
    BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"));
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("Overflow");
  return Number(n);
}
export const money = (n: number) =>
  `${n < 0 ? "-" : ""}₹${Math.abs(n / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
