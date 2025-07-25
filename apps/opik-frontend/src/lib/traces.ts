import md5 from "md5";
import get from "lodash/get";
import last from "lodash/last";
import findLast from "lodash/findLast";
import isArray from "lodash/isArray";
import isNumber from "lodash/isNumber";
import isObject from "lodash/isObject";
import isString from "lodash/isString";
import { TAG_VARIANTS } from "@/components/ui/tag";
import { ExperimentItem } from "@/types/datasets";
import { TRACE_VISIBILITY_MODE } from "@/types/traces";

const MESSAGES_DIVIDER = `\n\n  ----------------- \n\n`;

export const generateTagVariant = (label: string) => {
  const hash = md5(label);
  const index = parseInt(hash.slice(-8), 16);
  return TAG_VARIANTS[index % TAG_VARIANTS.length];
};

export const isObjectSpan = (object: object) => get(object, "trace_id", false);

export const isNumericFeedbackScoreValid = (
  { min, max }: { min: number; max: number },
  value?: number | "",
) => isNumber(value) && value >= min && value <= max;

export const traceExist = (item: ExperimentItem) =>
  item.output || item.input || item.feedback_scores;

export const traceVisible = (item: ExperimentItem) =>
  item.trace_visibility_mode === TRACE_VISIBILITY_MODE.default;

type PrettifyMessageConfig = {
  type: "input" | "output";
};

type PrettifyMessageResponse = {
  message: object | string | undefined;
  prettified: boolean;
};

const prettifyOpenAIMessageLogic = (
  message: object | string | undefined,
  config: PrettifyMessageConfig,
): string | undefined => {
  if (
    config.type === "input" &&
    isObject(message) &&
    "messages" in message &&
    isArray(message.messages)
  ) {
    const lastMessage = last(message.messages);
    if (lastMessage && isObject(lastMessage) && "content" in lastMessage) {
      if (isString(lastMessage.content) && lastMessage.content.length > 0) {
        return lastMessage.content;
      } else if (isArray(lastMessage.content)) {
        const lastTextContent = findLast(
          lastMessage.content,
          (c) => c.type === "text",
        );

        if (
          lastTextContent &&
          "text" in lastTextContent &&
          isString(lastTextContent.text) &&
          lastTextContent.text.length > 0
        ) {
          return lastTextContent.text;
        }
      }
    }
  } else if (
    config.type === "output" &&
    isObject(message) &&
    "choices" in message &&
    isArray(message.choices)
  ) {
    const lastChoice = last(message.choices);
    if (
      lastChoice &&
      "message" in lastChoice &&
      isObject(lastChoice.message) &&
      "content" in lastChoice.message &&
      isString(lastChoice.message.content) &&
      lastChoice.message.content.length > 0
    ) {
      return lastChoice.message.content;
    }
  }
};

const prettifyOpenAIAgentsMessageLogic = (
  message: object | string | undefined,
  config: PrettifyMessageConfig,
): string | undefined => {
  if (
    config.type === "input" &&
    isObject(message) &&
    "input" in message &&
    isArray(message.input)
  ) {
    const userMessages = message.input.filter(
      (m) =>
        isObject(m) &&
        "role" in m &&
        m.role === "user" &&
        "content" in m &&
        isString(m.content) &&
        m.content !== "",
    );

    if (userMessages.length > 0) {
      return userMessages.map((m) => m.content).join(MESSAGES_DIVIDER);
    }
  } else if (
    config.type === "output" &&
    isObject(message) &&
    "output" in message &&
    isArray(message.output)
  ) {
    const assistantMessageObjects = message.output.filter(
      (m) =>
        isObject(m) &&
        "role" in m &&
        m.role === "assistant" &&
        "type" in m &&
        m.type === "message" &&
        "content" in m &&
        isArray(m.content),
    );

    const userMessages = assistantMessageObjects.reduce<string[]>((acc, m) => {
      return acc.concat(
        m.content
          .filter(
            (c: unknown) =>
              isObject(c) &&
              "type" in c &&
              c.type === "output_text" &&
              "text" in c &&
              isString(c.text) &&
              c.text !== "",
          )
          .map((c: { text: string }) => c.text),
      );
    }, []);

    if (userMessages.length > 0) {
      return userMessages.join(MESSAGES_DIVIDER);
    }
  }

  return undefined;
};

const prettifyADKMessageLogic = (
  message: object | string | undefined,
  config: PrettifyMessageConfig,
): string | undefined => {
  if (config.type === "input" && isObject(message)) {
    const unwrappedMessage =
      !("parts" in message) &&
      "contents" in message &&
      isArray(message.contents)
        ? last(message.contents)
        : message;

    if (
      isObject(unwrappedMessage) &&
      "parts" in unwrappedMessage &&
      isArray(unwrappedMessage.parts)
    ) {
      const lastPart = last(unwrappedMessage.parts);
      if (isObject(lastPart) && "text" in lastPart && isString(lastPart.text)) {
        return lastPart.text;
      }
    }
  } else if (
    config.type === "output" &&
    isObject(message) &&
    "content" in message &&
    isObject(message.content) &&
    "parts" in message.content &&
    isArray(message.content.parts)
  ) {
    const lastPart = last(message.content.parts);
    if (isObject(lastPart) && "text" in lastPart && isString(lastPart.text)) {
      return lastPart.text;
    }
  }
};

const prettifyLangGraphLogic = (
  message: object | string | undefined,
  config: PrettifyMessageConfig,
): string | undefined => {
  if (
    config.type === "input" &&
    isObject(message) &&
    "messages" in message &&
    isArray(message.messages)
  ) {
    // Find the first human message
    const humanMessages = message.messages.filter(
      (m) =>
        isObject(m) &&
        "type" in m &&
        m.type === "human" &&
        "content" in m &&
        isString(m.content) &&
        m.content !== "",
    );

    if (humanMessages.length > 0) {
      return humanMessages[0].content;
    }
  } else if (
    config.type === "output" &&
    isObject(message) &&
    "messages" in message &&
    isArray(message.messages)
  ) {
    // Get the last AI message, and extract the string output from the various supported formats
    const aiMessages = [];

    // Iterate on all AI messages
    for (const m of message.messages) {
      if (isObject(m) && "type" in m && m.type === "ai" && "content" in m) {
        // The message can either contains a string attribute named `content`
        if (isString(m.content)) {
          aiMessages.push(m.content);
        }
        // Or content can be an array with text content. For example when using OpenAI chat model with the Responses API
        // https://python.langchain.com/docs/integrations/chat/openai/#responses-api
        else if (isArray(m.content)) {
          const textItems = m.content.filter(
            (c) =>
              isObject(c) &&
              "type" in c &&
              c.type === "text" &&
              "text" in c &&
              isString(c.text) &&
              c.text !== "",
          );

          // Check that there is only one text item
          if (textItems.length === 1) {
            aiMessages.push(textItems[0].text);
          }
        }
      }
    }

    if (aiMessages.length > 0) {
      return last(aiMessages);
    }
  }
};

const prettifyLangChainLogic = (
  message: object | string | undefined,
  config: PrettifyMessageConfig,
): string | undefined => {
  // Some older models can return multiple generations, and Langchain can be
  // called with several prompts at the same time. When that happens, there is
  // no clear way to "know" which generation or prompt the user wants to see.
  // Given that it's not the common case, we should only prettify when there
  // is a single prompt and generation.
  if (
    config.type === "input" &&
    isObject(message) &&
    "messages" in message &&
    isArray(message.messages) &&
    message.messages.length == 1 &&
    isArray(message.messages[0])
  ) {
    // Find the first human message
    const humanMessages = message.messages[0].filter(
      (m) =>
        isObject(m) &&
        "type" in m &&
        m.type === "human" &&
        "content" in m &&
        isString(m.content) &&
        m.content !== "",
    );

    if (humanMessages.length > 0) {
      return humanMessages[0].content;
    }
  } else if (
    config.type === "output" &&
    isObject(message) &&
    "generations" in message &&
    isArray(message.generations) &&
    message.generations.length == 1 &&
    isArray(message.generations[0])
  ) {
    // Get the last AI message
    const aiMessages = message.generations[0].filter(
      (m) =>
        isObject(m) &&
        "message" in m &&
        isObject(m.message) &&
        "kwargs" in m.message &&
        isObject(m.message.kwargs) &&
        "type" in m.message.kwargs &&
        m.message.kwargs.type === "ai" &&
        "text" in m &&
        isString(m.text) &&
        m.text !== "",
    );

    if (aiMessages.length > 0) {
      return last(aiMessages).text;
    }
  }
};

/**
 * Prettifies Demo project's blocks-based message format.
 *
 * Handles two formats:
 * - Direct: { blocks: [{ block_type: "text", text: "..." }] }
 * - Nested: { output: { blocks: [{ block_type: "text", text: "..." }] } }
 */
const prettifyDemoProjectLogic = (
  message: object | string | undefined,
  config: PrettifyMessageConfig,
): string | undefined => {
  const extractTextFromBlocks = (blocks: unknown[]): string | undefined => {
    const textBlocks = blocks.filter(
      (block): block is { block_type: string; text: string } =>
        isObject(block) &&
        "block_type" in block &&
        block.block_type === "text" &&
        "text" in block &&
        isString(block.text) &&
        block.text.trim() !== "",
    );

    return textBlocks.length > 0
      ? textBlocks.map((block) => block.text).join("\n\n")
      : undefined;
  };

  // Handle direct blocks structure: { blocks: [...] }
  if (isObject(message) && "blocks" in message && isArray(message.blocks)) {
    return extractTextFromBlocks(message.blocks);
  }

  // Handle nested blocks structure: { output: { blocks: [...] } }
  if (
    config.type === "output" &&
    isObject(message) &&
    "output" in message &&
    isObject(message.output) &&
    "blocks" in message.output &&
    isArray(message.output.blocks)
  ) {
    return extractTextFromBlocks(message.output.blocks);
  }

  return undefined;
};

const prettifyGenericLogic = (
  message: object | string | undefined,
  config: PrettifyMessageConfig,
): string | undefined => {
  const PREDEFINED_KEYS_MAP = {
    input: [
      "question",
      "messages",
      "user_input",
      "query",
      "input_prompt",
      "prompt",
      "sys.query", // Dify
    ],
    output: ["answer", "output", "response"],
  };

  let unwrappedMessage = message;

  if (isObject(message) && Object.keys(message).length === 1) {
    unwrappedMessage = get(message, Object.keys(message)[0]);
  }

  if (isString(unwrappedMessage)) {
    return unwrappedMessage;
  }

  if (isObject(unwrappedMessage)) {
    if (Object.keys(unwrappedMessage).length === 1) {
      const value = get(unwrappedMessage, Object.keys(unwrappedMessage)[0]);

      if (isString(value)) {
        return value;
      }
    } else {
      for (const key of PREDEFINED_KEYS_MAP[config.type]) {
        const value = get(unwrappedMessage, key);
        if (isString(value)) {
          return value;
        }
      }
    }
  }
};

export const prettifyMessage = (
  message: object | string | undefined,
  config: PrettifyMessageConfig = {
    type: "input",
  },
) => {
  if (isString(message)) {
    return {
      message,
      prettified: false,
    } as PrettifyMessageResponse;
  }
  try {
    let processedMessage = prettifyOpenAIMessageLogic(message, config);

    if (!isString(processedMessage)) {
      processedMessage = prettifyOpenAIAgentsMessageLogic(message, config);
    }

    if (!isString(processedMessage)) {
      processedMessage = prettifyADKMessageLogic(message, config);
    }

    if (!isString(processedMessage)) {
      processedMessage = prettifyLangGraphLogic(message, config);
    }

    if (!isString(processedMessage)) {
      processedMessage = prettifyLangChainLogic(message, config);
    }

    if (!isString(processedMessage)) {
      processedMessage = prettifyDemoProjectLogic(message, config);
    }

    if (!isString(processedMessage)) {
      processedMessage = prettifyGenericLogic(message, config);
    }

    return {
      message: processedMessage ? processedMessage : message,
      prettified: Boolean(processedMessage),
    } as PrettifyMessageResponse;
  } catch (error) {
    return {
      message,
      prettified: false,
    } as PrettifyMessageResponse;
  }
};
