/**
 * Ids from the v1 packs ("classic-easy-17"): the only code that knows their format.
 *
 * Since the app moved to the v2 packs, every board is named by its content id
 * (engine/content-id.ts). Solved lists from before keep their v1 ids, and those solves count toward
 * the level number. v1 kept no count per mode and difficulty, so this counts distinct boards.
 *
 * It counts when read instead of converting the lists once: a phone still on 0.3 or older goes on
 * syncing v1 ids until it updates. Converting needs a format version that stops those phones
 * syncing first; until then this stays.
 */
const V1_ID = /^(classic|killer|queens)-(easy|medium|hard|expert)-\d+$/;

export const isV1Id = (id: string): boolean => V1_ID.test(id);

/** How many of a solved list's ids are v1 ids. */
export const v1Solves = (ids: readonly string[]): number => ids.filter(isV1Id).length;
