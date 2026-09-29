export function trxToSun(value: string): string {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) throw new Error('TRX 金额必须为非负数字，最多 6 位小数');
  const [whole, decimal = ''] = value.split('.');
  return (BigInt(whole) * 1_000_000n + BigInt(decimal.padEnd(6, '0'))).toString();
}
export function formatTrx(sun: string, digits = 6): string {
  const n = BigInt(sun), abs = n < 0n ? -n : n;
  const fraction = (abs % 1_000_000n).toString().padStart(6, '0').slice(0, digits).replace(/0+$/, '');
  return `${n < 0n ? '−' : ''}${(abs / 1_000_000n).toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}
