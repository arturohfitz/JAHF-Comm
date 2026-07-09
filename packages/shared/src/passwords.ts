import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const algorithm = "scrypt";
const keyLength = 64;
const params = {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, keyLength);

  return [
    algorithm,
    params.N,
    params.r,
    params.p,
    salt.toString("base64url"),
    key.toString("base64url")
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined
): Promise<boolean> {
  if (!storedHash) {
    return false;
  }

  const [storedAlgorithm, n, r, p, salt, key] = storedHash.split("$");

  if (storedAlgorithm !== algorithm || !n || !r || !p || !salt || !key) {
    return false;
  }

  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(
    password,
    Buffer.from(salt, "base64url"),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: params.maxmem
    }
  );

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function scrypt(
  password: string,
  salt: Buffer,
  length: number,
  options = params
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(key);
    });
  });
}
