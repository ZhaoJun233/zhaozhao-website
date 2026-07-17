import { describe, expect, it } from "vitest";
import {
  messageInputSchema,
  messageStatusSchema,
} from "../../src/lib/database/message-repository";

describe("guestbook message validation", () => {
  it("normalizes optional contact fields", () => {
    expect(messageInputSchema.parse({
      name: " 来访者 ",
      email: "",
      website: "",
      content: " 你好，昭昭。 ",
    })).toEqual({
      name: "来访者",
      email: undefined,
      website: undefined,
      content: "你好，昭昭。",
    });
  });

  it("rejects invalid moderation states and oversized messages", () => {
    expect(() => messageStatusSchema.parse("deleted")).toThrow();
    expect(() => messageInputSchema.parse({
      name: "测试",
      content: "字".repeat(2_001),
    })).toThrow();
  });
});
