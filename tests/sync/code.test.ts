import { createHash } from "node:crypto";
import { ALPHABET, bucketId, CODE_LENGTH, formatCode, generateCode, normalizeCode } from "../../src/sync/code";

describe("sync code", () => {
  it("generates 16 characters of the Crockford alphabet from the bytes it is given", () => {
    const code = generateCode();
    expect(code).toHaveLength(CODE_LENGTH);
    for (const c of code) expect(ALPHABET).toContain(c);
    expect(generateCode()).not.toBe(code);
    // Each byte picks one character: 0 → "0", 31 → "Z", 32 wraps to "0".
    expect(generateCode((a) => a.map((_, i) => [0, 31, 32, 255][i % 4]!))).toBe("0Z0Z".repeat(4));
  });

  it("normalises what a player typed and rejects anything that isn't a whole code", () => {
    const code = "ABCD2345EFGH6789";
    expect(normalizeCode(code)).toBe(code);
    expect(normalizeCode(" abcd-2345 efgh_6789 ")).toBe(code);
    expect(normalizeCode("ABCD2345EFGH678I")).toBe("ABCD2345EFGH6781"); // I and L read as 1
    expect(normalizeCode("ABCD2345EFGH678l")).toBe("ABCD2345EFGH6781");
    expect(normalizeCode("ABCD2345EFGH678O")).toBe("ABCD2345EFGH6780"); // O reads as 0
    expect(normalizeCode("ABCD2345EFGH678")).toBeNull(); // 15
    expect(normalizeCode("ABCD2345EFGH67890")).toBeNull(); // 17
    expect(normalizeCode("ABCD2345EFGH678U")).toBeNull(); // not in the alphabet
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode(formatCode(generateCode()))).not.toBeNull();
  });

  it("formats as four groups", () => {
    expect(formatCode("ABCD2345EFGH6789")).toBe("ABCD-2345-EFGH-6789");
  });

  it("names the cloud file by a prefixed SHA-256 of the code, in hex", async () => {
    const code = "ABCD2345EFGH6789";
    const id = await bucketId(code);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).toBe(createHash("sha256").update(`nonet-sync:${code}`).digest("hex"));
    expect(await bucketId("ABCD2345EFGH6780")).not.toBe(id);
  });
});
