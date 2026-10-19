const ITERATIONS = 310_000;

export async function verifyOperationsOperator(email: string, password: string) {
  const expectedEmail = process.env["OPERATIONS_OPERATOR_EMAIL"]?.trim().toLowerCase();
  const encodedHash = process.env["OPERATIONS_OPERATOR_PASSWORD_HASH"];
  if (!expectedEmail || !encodedHash) {
    return {
      ok: false as const,
      status: 503,
      message: "Operations operator authentication is not configured.",
    };
  }
  if (!constantTimeTextEqual(email.trim().toLowerCase(), expectedEmail)) {
    await performDummyDerivation(password);
    return { ok: false as const, status: 401, message: "Invalid operator credentials." };
  }
  const parts = encodedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") {
    return { ok: false as const, status: 503, message: "Operations password hash is invalid." };
  }
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < ITERATIONS || !parts[2] || !parts[3]) {
    return { ok: false as const, status: 503, message: "Operations password hash is invalid." };
  }
  const actual = await derive(
    password,
    fromBase64(parts[2]),
    iterations,
    fromBase64(parts[3]).byteLength,
  );
  if (!constantTimeBytesEqual(actual, fromBase64(parts[3]))) {
    return { ok: false as const, status: 401, message: "Invalid operator credentials." };
  }
  const idHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedEmail));
  const operatorId = Array.from(new Uint8Array(idHash))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    ok: true as const,
    operator: {
      operator_id: operatorId,
      email: expectedEmail,
      role: process.env["OPERATIONS_OPERATOR_ROLE"] || "operations_admin",
    },
  };
}

export async function hashOperationsPassword(
  password: string,
  salt = crypto.getRandomValues(new Uint8Array(16)),
) {
  const hash = await derive(password, salt, ITERATIONS, 32);
  return `pbkdf2_sha256$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

async function derive(password: string, salt: Uint8Array, iterations: number, bytes: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const saltBuffer = salt.buffer.slice(
    salt.byteOffset,
    salt.byteOffset + salt.byteLength,
  ) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

async function performDummyDerivation(password: string) {
  await derive(password, new Uint8Array(16), ITERATIONS, 32);
}

function constantTimeTextEqual(left: string, right: string) {
  return constantTimeBytesEqual(new TextEncoder().encode(left), new TextEncoder().encode(right));
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array) {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1)
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return mismatch === 0;
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function toBase64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}
