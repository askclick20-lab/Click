/** Bitcoin/Solana base58 alphabet (no 0, O, I, l). */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) MAP[ALPHABET.charCodeAt(i)] = i;

/** Encode bytes to base58 (same algorithm as common `bs58` implementations). */
export function base58Encode(buffer: Uint8Array): string {
  if (buffer.length === 0) return "";
  const digits: number[] = [0];
  for (let i = 0; i < buffer.length; i++) {
    let carry = buffer[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  for (let i = 0; buffer[i] === 0 && i < buffer.length - 1; i++) digits.push(0);
  return digits
    .reverse()
    .map((d) => ALPHABET[d]!)
    .join("");
}

export function base58Decode(input: string): Uint8Array | undefined {
  if (input.length === 0) return new Uint8Array(0);
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 128 || MAP[code]! < 0) return undefined;
  }
  const bytes: number[] = [0];
  for (let i = 0; i < input.length; i++) {
    let value = MAP[input.charCodeAt(i)]!;
    for (let j = 0; j < bytes.length; j++) {
      value += bytes[j]! * 58;
      bytes[j] = value & 255;
      value >>= 8;
    }
    while (value > 0) {
      bytes.push(value & 255);
      value >>= 8;
    }
  }
  for (let i = 0; input[i] === "1" && i < input.length - 1; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}
