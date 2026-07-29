import { describe, expect, it } from "vitest";
import { dimeChatMessages, dimeChatThreads } from "../drizzle/schema";
import { createDimeChatThread } from "./routers/dimeChats";

type ThreadRow = {
  id: number;
  userId: number;
  title: string;
};

type MessageRow = {
  threadId: number;
  seq: number;
  role: "user" | "assistant";
  content: string;
};

function createTransactionalFake(
  options: { failInitialMessage?: boolean } = {}
) {
  let committedThreads: ThreadRow[] = [];
  let committedMessages: MessageRow[] = [];
  let transactionCalls = 0;

  const db = {
    async transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      transactionCalls += 1;
      const stagedThreads = committedThreads.map(row => ({ ...row }));
      const stagedMessages = committedMessages.map(row => ({ ...row }));

      const tx = {
        insert(table: unknown) {
          return {
            values(values: unknown) {
              if (table === dimeChatThreads) {
                const value = values as Omit<ThreadRow, "id">;
                const row = { id: 41, ...value };
                stagedThreads.push(row);
                return {
                  async $returningId() {
                    return [{ id: row.id }];
                  },
                };
              }

              if (table === dimeChatMessages) {
                if (options.failInitialMessage) {
                  throw new Error("forced initial-message insert failure");
                }
                const rows = (
                  Array.isArray(values) ? values : [values]
                ) as MessageRow[];
                stagedMessages.push(...rows.map(row => ({ ...row })));
                return Promise.resolve([{ affectedRows: rows.length }]);
              }

              throw new Error("unexpected table");
            },
          };
        },
      };

      const result = await work(tx);
      committedThreads = stagedThreads;
      committedMessages = stagedMessages;
      return result;
    },
  };

  return {
    db,
    get committedThreads() {
      return committedThreads;
    },
    get committedMessages() {
      return committedMessages;
    },
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

describe("Dime Chat conversation persistence", () => {
  it("atomically creates a thread with its exact first settled turn", async () => {
    const fake = createTransactionalFake();
    const firstMessage =
      "Break down the market movement for tonight's matchup.";
    const firstAssistantMessage =
      "The market moved two points after the injury report.";

    const result = await createDimeChatThread(
      fake.db,
      17,
      firstMessage,
      firstAssistantMessage
    );

    // 2026-07-29 r3: the stored title comes from the topic-detection engine
    // (deriveThreadTitle), not the raw message — here the fallback path:
    // trailing period dropped, word-boundary truncation to the 48-char band.
    const derivedTitle = "Break down the market movement for tonight's…";
    expect(result).toEqual({
      threadId: 41,
      title: derivedTitle,
    });
    expect(fake.transactionCalls).toBe(1);
    expect(fake.committedThreads).toEqual([
      {
        id: 41,
        userId: 17,
        title: derivedTitle,
      },
    ]);
    expect(fake.committedMessages).toEqual([
      {
        threadId: 41,
        seq: 1,
        role: "user",
        content: firstMessage,
      },
      {
        threadId: 41,
        seq: 2,
        role: "assistant",
        content: firstAssistantMessage,
      },
    ]);
  });

  it("rolls back the thread when the first-message insert fails", async () => {
    const fake = createTransactionalFake({ failInitialMessage: true });

    await expect(
      createDimeChatThread(fake.db, 17, "Will this question be stored?")
    ).rejects.toThrow("forced initial-message insert failure");

    expect(fake.transactionCalls).toBe(1);
    expect(fake.committedThreads).toEqual([]);
    expect(fake.committedMessages).toEqual([]);
  });
});
