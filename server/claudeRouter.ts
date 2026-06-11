import { z } from "zod";
import { router } from "./_core/trpc";
import { ownerProcedure } from "./routers/appUsers";
import { invokeClaude, UIUX_SYSTEM_PROMPT } from "./_core/claude";

export const claudeRouter = router({
  chat: ownerProcedure
    .input(z.object({
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(50000) })).min(1).max(50),
      context: z.object({ currentPage: z.string().optional(), additionalContext: z.string().optional() }).optional(),
    }))
    .mutation(async ({ input }) => {
      let systemPrompt = UIUX_SYSTEM_PROMPT;
      if (input.context?.currentPage || input.context?.additionalContext) {
        const lines: string[] = [];
        if (input.context.currentPage) lines.push(`Current page: ${input.context.currentPage}`);
        if (input.context.additionalContext) lines.push(input.context.additionalContext);
        systemPrompt = `${UIUX_SYSTEM_PROMPT}\n\nSession context:\n${lines.join("\n")}`;
      }
      const response = await invokeClaude({ messages: input.messages, systemPrompt });
      return { content: response.content, inputTokens: response.inputTokens, outputTokens: response.outputTokens, model: response.model };
    }),
});
