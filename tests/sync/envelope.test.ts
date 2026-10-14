import { BACKUP_VERSION, backupSolved, makeEnvelope, parseBackup, readEnvelope } from "../../src/sync/envelope";

describe("envelope", () => {
  it("wraps data under a header with this version and the time", () => {
    expect(makeEnvelope({ seen: ["a"] }, new Date("2026-10-14T12:00:00Z"))).toEqual({
      app: "nonet",
      version: BACKUP_VERSION,
      exported: "2026-10-14T12:00:00.000Z",
      data: { seen: ["a"] },
    });
  });

  it("reads this version and older ones, flags a newer one, and rejects anything else", () => {
    const text = (v: unknown) => JSON.stringify(v);
    expect(readEnvelope(text({ app: "nonet", version: 1, exported: "", data: { a: 1 } }))).toEqual({ app: "nonet", version: 1, exported: "", data: { a: 1 } });
    expect(readEnvelope(text({ app: "nonet", version: BACKUP_VERSION, data: {} }))).toMatchObject({ version: BACKUP_VERSION, exported: "", data: {} });
    expect(readEnvelope(text({ app: "nonet", version: BACKUP_VERSION + 1, data: {} }))).toBe("newer");
    expect(readEnvelope("not json")).toBeNull();
    expect(readEnvelope("[]")).toBeNull();
    expect(readEnvelope(text({ app: "other", version: 1, data: {} }))).toBeNull();
    expect(readEnvelope(text({ app: "nonet", version: 1, data: [] }))).toBeNull();
    expect(readEnvelope(text({ app: "nonet", version: "1", data: {} }))).toBeNull();
    // A backup file from a newer app is simply not one this version can restore.
    expect(parseBackup(text({ app: "nonet", version: BACKUP_VERSION + 1, data: {} }))).toBeNull();
    expect(parseBackup(text({ app: "nonet", version: 1, data: {} }))).toMatchObject({ version: 1 });
  });

  it("counts solves in either progress shape", () => {
    const env = (progress: unknown) => makeEnvelope({ progress });
    expect(backupSolved(env({ total: 3 }))).toBe(3);
    expect(backupSolved(env({ counters: { a: { total: 2, hinted: {} }, b: { total: 5, hinted: {} } } }))).toBe(7);
    expect(backupSolved(env({ total: 1, counters: { a: { total: 2, hinted: {} } } }))).toBe(3);
    expect(backupSolved(env(undefined))).toBe(0);
    expect(backupSolved(env({ counters: { a: "no" } }))).toBe(0);
  });
});
