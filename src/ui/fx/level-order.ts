/** Pure helpers for level entrances: which style comes next, and orders for cells to arrive in. */

/** A shuffle bag over `count` styles: each one once per round, never the same twice in a row. */
export function createStyleBag(count: number, rng: () => number = Math.random): { next(): number } {
  let bag: number[] = [];
  let last = -1;
  return {
    next(): number {
      if (!bag.length) {
        bag = [...Array(count).keys()];
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [bag[i], bag[j]] = [bag[j]!, bag[i]!];
        }
        // A new round mustn't open with the style the last one closed on.
        if (bag[0] === last && bag.length > 1) [bag[0], bag[1]] = [bag[1]!, bag[0]!];
      }
      last = bag.shift()!;
      return last;
    },
  };
}

/** Each cell's place (row-major) in a clockwise spiral from the top-left corner in to the centre. */
export function spiralOrder(n: number): number[] {
  const rank = new Array<number>(n * n).fill(-1);
  let top = 0;
  let left = 0;
  let bottom = n - 1;
  let right = n - 1;
  let k = 0;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) rank[top * n + c] = k++;
    for (let r = top + 1; r <= bottom; r++) rank[r * n + right] = k++;
    if (top < bottom) for (let c = right - 1; c >= left; c--) rank[bottom * n + c] = k++;
    if (left < right) for (let r = bottom - 1; r > top; r--) rank[r * n + left] = k++;
    top++;
    left++;
    bottom--;
    right--;
  }
  return rank;
}
