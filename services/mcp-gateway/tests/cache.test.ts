import { describe, expect, it } from "vitest";

import { cosine, pickBestMatch } from "../src/cache.js";

describe("cosine", () => {
  it("identical vectors score 1", () => {
    const v = [1, 2, 3];
    expect(cosine(v, v)).toBeCloseTo(1, 6);
  });

  it("orthogonal vectors score 0", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it("opposite vectors score -1", () => {
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it("mismatched lengths score 0", () => {
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
  });

  it("zero vector scores 0", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe("pickBestMatch", () => {
  const results = [{ content: "hello", sourceName: "a", score: 0.9 }];

  it("returns null when no entry clears the threshold", () => {
    const q = [1, 0, 0];
    const entries = [{ embedding: [0, 1, 0], results }];
    expect(pickBestMatch(q, entries, 0.5)).toBeNull();
  });

  it("returns the best match above threshold", () => {
    const q = [1, 0, 0];
    const entries = [
      { embedding: [0.99, 0.14, 0], results },
      { embedding: [0.5, 0.5, 0], results },
      { embedding: [1, 0, 0], results }, // best
    ];
    const best = pickBestMatch(q, entries, 0.9);
    expect(best).not.toBeNull();
    expect(best!.score).toBeCloseTo(1, 6);
  });
});
