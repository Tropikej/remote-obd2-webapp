const TOKEN_LEN = 32;

const normalizeBase64 = (value: string) => {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  return padding ? normalized + "=".repeat(4 - padding) : normalized;
};

export const decodeDongleToken = (token: string) => {
  const normalized = normalizeBase64(token);
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length !== TOKEN_LEN) {
    throw new Error("Dongle token must be 32 bytes.");
  }
  return bytes;
};
