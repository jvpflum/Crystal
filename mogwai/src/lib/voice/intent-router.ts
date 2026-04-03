/**
 * IntentRouter — converts natural language transcripts into StructuredActions.
 *
 * Two-tier classification:
 *   1. Fast local pattern matching for common intents (file ops, git, search, etc.)
 *   2. LLM fallback via OpenClaw for ambiguous/complex intents
 *
 * The router determines:
 *   - Whether the user's intent can be answered directly (chat_reply)
 *   - Whether it requires OpenClaw task dispatch (openclaw_task / openclaw_command)
 *   - Whether it requires confirmation before execution (confirm_required)
 */

import type { StructuredAction } from "./types";
import {
  createChatReply,
  createOpenClawTask,
  createOpenClawCommand,
  requiresConfirmation,
  createConfirmationAction,
  classifyRisk,
} from "./actions";

interface IntentMatch {
  intent: string;
  operation: string;
  args: Record<string, string>;
  confidence: number;
}

// ── Pattern-based intent rules ─────────────────────────────────

interface IntentRule {
  patterns: RegExp[];
  intent: string;
  operation: string;
  extractArgs?: (match: RegExpMatchArray, input: string) => Record<string, string>;
}

const INTENT_RULES: IntentRule[] = [
  // File operations
  {
    patterns: [
      /(?:read|open|show|display|cat)\s+(?:the\s+)?(?:file\s+)?(.+)/i,
      /what(?:'s| is)\s+in\s+(.+)/i,
    ],
    intent: "file_read",
    operation: "read",
    extractArgs: (m) => ({ path: m[1].trim() }),
  },
  {
    patterns: [
      /(?:write|save|create)\s+(?:a\s+)?(?:file\s+)?(?:to\s+)?(.+)/i,
    ],
    intent: "file_write",
    operation: "file_write",
    extractArgs: (m) => ({ path: m[1].trim() }),
  },
  {
    patterns: [
      /(?:delete|remove|rm)\s+(?:the\s+)?(?:file\s+)?(.+)/i,
    ],
    intent: "file_delete",
    operation: "file_delete",
    extractArgs: (m) => ({ path: m[1].trim() }),
  },

  // Git operations
  {
    patterns: [/git\s+status/i, /(?:show|check)\s+git\s+status/i],
    intent: "git_status",
    operation: "read",
  },
  {
    patterns: [/git\s+commit/i, /commit\s+(?:the\s+)?changes/i],
    intent: "git_commit",
    operation: "git_commit",
  },
  {
    patterns: [/git\s+push/i, /push\s+(?:to\s+)?(?:remote|origin)/i],
    intent: "git_push",
    operation: "git_push",
  },

  // Shell execution
  {
    patterns: [
      /(?:run|execute)\s+(?:the\s+)?(?:command\s+)?(.+)/i,
      /(?:shell|terminal|cmd)\s+(.+)/i,
    ],
    intent: "shell_execute",
    operation: "shell_execute",
    extractArgs: (m) => ({ command: m[1].trim() }),
  },

  // Search
  {
    patterns: [
      /(?:search|find|look\s+for|look\s+up)\s+(.+)/i,
      /(?:google|web\s+search)\s+(.+)/i,
    ],
    intent: "search",
    operation: "search",
    extractArgs: (m) => ({ query: m[1].trim() }),
  },

  // Scheduling / cron
  {
    patterns: [
      /(?:schedule|set\s+up|create)\s+(?:a\s+)?(?:cron|scheduled|recurring)\s+(?:job|task)\s+(.+)/i,
    ],
    intent: "cron_create",
    operation: "cron_create",
    extractArgs: (m) => ({ description: m[1].trim() }),
  },

  // Memory
  {
    patterns: [
      /(?:remember|save|store|memorize)\s+(?:that\s+)?(.+)/i,
      /(?:add\s+to|save\s+to)\s+memory\s+(.+)/i,
    ],
    intent: "memory_save",
    operation: "memory_write",
    extractArgs: (m) => ({ content: m[1].trim() }),
  },
  {
    patterns: [
      /(?:what\s+do\s+you\s+)?(?:remember|recall|know)\s+about\s+(.+)/i,
      /(?:search|check)\s+memory\s+(?:for\s+)?(.+)/i,
    ],
    intent: "memory_search",
    operation: "read",
    extractArgs: (m) => ({ query: m[1].trim() }),
  },

  // System / status
  {
    patterns: [
      /(?:system|server|gpu|status)\s+(?:status|check|info)/i,
      /how(?:'s| is)\s+(?:the\s+)?(?:system|server|gpu)/i,
    ],
    intent: "system_status",
    operation: "read",
  },
];

// Simple conversational patterns that should be answered directly, not sent to OpenClaw
const CONVERSATIONAL_PATTERNS = [
  /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))\b/i,
  /^(?:how\s+are\s+you|what's\s+up|how\s+do\s+you\s+do)/i,
  /^(?:thank|thanks|thank\s+you)/i,
  /^(?:bye|goodbye|see\s+you|good\s+night)/i,
  /^(?:yes|no|ok|okay|sure|nope|yep|yeah)\s*[.!?]*$/i,
  /^(?:what\s+(?:can\s+you\s+do|are\s+you|is\s+your\s+name))/i,
  /^(?:help|what\s+commands)/i,
  /^(?:cancel|stop|never\s*mind|forget\s+it)/i,
];

export class IntentRouter {
  /**
   * Classify a user transcript into a StructuredAction.
   *
   * Returns:
   *   - chat_reply for conversational/direct-answer intents
   *   - openclaw_task/openclaw_command for actionable intents
   *   - confirm_required wrapper if the action is risky
   */
  classify(transcript: string): StructuredAction {
    const trimmed = transcript.trim();
    if (!trimmed) {
      return createChatReply("I didn't catch that. Could you repeat?");
    }

    // Check conversational patterns first
    for (const pattern of CONVERSATIONAL_PATTERNS) {
      if (pattern.test(trimmed)) {
        return createChatReply(trimmed, "intent_router");
      }
    }

    // Try pattern-based intent matching
    const match = this._matchPatterns(trimmed);
    if (match && match.confidence >= 0.6) {
      return this._buildAction(match, trimmed);
    }

    // Default: delegate to OpenClaw as a general task
    const action = createOpenClawTask(
      trimmed,
      { operation: "general", raw_transcript: trimmed },
      0.5
    );

    if (requiresConfirmation(action)) {
      return createConfirmationAction(action, `Execute: "${trimmed}"?`);
    }

    return action;
  }

  /**
   * Async classification with LLM assistance for ambiguous intents.
   * Falls back to pattern matching if LLM is unavailable.
   */
  async classifyAsync(
    transcript: string,
    llmClassify?: (prompt: string) => Promise<string>
  ): Promise<StructuredAction> {
    const fast = this.classify(transcript);

    // If pattern matching is confident enough, use it directly
    if (fast.confidence >= 0.8 || fast.type === "chat_reply") {
      return fast;
    }

    // If we have LLM access, use it for ambiguous intents
    if (llmClassify) {
      try {
        const classificationPrompt = [
          "Classify the following user request into one of these categories:",
          "- chat_reply: conversational, greetings, general questions",
          "- file_read: reading/viewing files",
          "- file_write: creating/writing files (RISKY)",
          "- file_delete: deleting files (RISKY)",
          "- shell_execute: running commands (RISKY)",
          "- git_commit: committing changes (RISKY)",
          "- git_push: pushing to remote (RISKY)",
          "- search: web or file search",
          "- memory_save: saving information to memory",
          "- memory_search: recalling information",
          "- system_status: checking system status",
          "- general: everything else",
          "",
          `User request: "${transcript}"`,
          "",
          "Respond with ONLY the category name.",
        ].join("\n");

        const category = (await llmClassify(classificationPrompt)).trim().toLowerCase();
        const risk = classifyRisk(category);

        if (category === "chat_reply") {
          return createChatReply(transcript, "intent_router");
        }

        const action = createOpenClawCommand(
          transcript,
          { operation: category, raw_transcript: transcript },
          0.85
        );
        action.risk_level = risk;

        if (requiresConfirmation(action)) {
          return createConfirmationAction(action, `Execute ${category}: "${transcript}"?`);
        }
        return action;
      } catch {
        // LLM failed, fall back to pattern-based result
      }
    }

    return fast;
  }

  private _matchPatterns(input: string): IntentMatch | null {
    for (const rule of INTENT_RULES) {
      for (const pattern of rule.patterns) {
        const match = input.match(pattern);
        if (match) {
          return {
            intent: rule.intent,
            operation: rule.operation,
            args: rule.extractArgs?.(match, input) ?? {},
            confidence: 0.8,
          };
        }
      }
    }
    return null;
  }

  private _buildAction(match: IntentMatch, rawTranscript: string): StructuredAction {
    const payload = {
      operation: match.operation,
      intent: match.intent,
      raw_transcript: rawTranscript,
      ...match.args,
    };

    const isImmediate = ["read", "search", "system_status"].includes(match.operation);
    const action = isImmediate
      ? createOpenClawCommand(rawTranscript, payload, match.confidence)
      : createOpenClawTask(rawTranscript, payload, match.confidence);

    if (requiresConfirmation(action)) {
      return createConfirmationAction(
        action,
        `This will ${match.operation.replace("_", " ")}. Proceed?`
      );
    }

    return action;
  }
}
