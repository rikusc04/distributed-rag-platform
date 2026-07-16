// Thin wrapper around openai.embeddings.create for a single query string.

import OpenAI from "openai";

export class Embedder {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly expectedDim: number;

  constructor(apiKey: string, model: string, expectedDim: number) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.expectedDim = expectedDim;
  }

  async embed(query: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: query,
    });
    const vector = response.data[0]?.embedding;
    if (!vector) {
      throw new Error("openai returned no embedding");
    }
    if (vector.length !== this.expectedDim) {
      throw new Error(
        `embedding dim mismatch: got ${vector.length}, expected ${this.expectedDim}`,
      );
    }
    return vector;
  }
}
