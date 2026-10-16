/**
 * DukaanDost - LLM Agent & Tool-Calling Loop
 * Modern Gemini client using @google/genai SDK, session memory management,
 * intelligent retry handling for high-demand spikes, and tool-calling orchestration.
 */

const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const { getSystemPrompt, toolDeclarations } = require('./prompts');
const { incrementTurn, resetTurn } = require('./db');
const productsTool = require('./tools/products');
const billingTool = require('./tools/billing');
const inventoryTool = require('./tools/inventory');
const creditTool = require('./tools/credit');
const reportsTool = require('./tools/reports');

// Tool registry mapping declaration names to implementation functions
const toolRegistry = {
  search_product: productsTool.search_product,
  create_bill: billingTool.create_bill,
  update_stock: inventoryTool.update_stock,
  low_stock_alert: inventoryTool.low_stock_alert,
  expiring_soon: inventoryTool.expiring_soon,
  record_credit_payment: creditTool.record_credit_payment,
  get_customer_balance: creditTool.get_customer_balance,
  top_selling_products: reportsTool.top_selling_products,
  supplier_order_list: reportsTool.supplier_order_list,
  daily_closing_summary: reportsTool.daily_closing_summary
};

/**
 * Manages an interactive DukaanDost agent conversation session.
 */
class DukaanDostAgent {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.modelName]
   * @param {number} [options.maxIterations=8]
   */
  constructor(options = {}) {
    this.apiKey = (options.apiKey || process.env.GEMINI_API_KEY || '').trim();
    this.modelName = (options.modelName || process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
    this.activeModel = this.modelName;
    this.maxIterations = options.maxIterations || 8;
    this.chatSession = null;
    this.ai = null;
    this.isConfigured = Boolean(this.apiKey && this.apiKey !== 'your_key_here');

    if (this.isConfigured) {
      this.initGeminiClient();
    }
  }

  /**
   * Initializes or re-initializes the Gemini chat session.
   * @param {string} [modelOverride]
   */
  initGeminiClient(modelOverride) {
    try {
      this.activeModel = modelOverride || this.modelName;
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
      this.chatSession = this.ai.chats.create({
        model: this.activeModel,
        config: {
          systemInstruction: getSystemPrompt(),
          tools: [{ functionDeclarations: toolDeclarations }]
        }
      });
    } catch (err) {
      console.error('Warning: Failed to initialize Gemini client:', err.message);
      this.chatSession = null;
    }
  }

  /**
   * Executes a registered tool safely with try/catch.
   * @param {string} name
   * @param {object} args
   * @returns {object}
   */
  executeTool(name, args) {
    const toolFn = toolRegistry[name];
    if (!toolFn) {
      return {
        ok: false,
        error: `Tool "${name}" is not recognized by DukaanDost.`
      };
    }

    try {
      return toolFn(args);
    } catch (err) {
      return {
        ok: false,
        error: `Error executing tool "${name}": ${err.message}`
      };
    }
  }

  /**
   * Sends a user message through the agent's function-calling loop.
   * Capped at maxIterations (8) to prevent runaway loops.
   * Includes backoff retry for transient API errors and high-demand failover.
   *
   * @param {string} userMessage
   * @returns {Promise<{ reply: string, toolCallsMade: Array<object> }>}
   */
  async sendMessage(userMessage) {
    if (!userMessage || !userMessage.trim()) {
      return {
        reply: "Please ask a question or give an instruction (e.g., 'search maggi' or 'Sharma ji ka hisab').",
        toolCallsMade: []
      };
    }

    // Increment user turn counter for confirmation boundary enforcement
    incrementTurn();

    if (!this.isConfigured || !this.chatSession) {
      return {
        reply: "Namaste! GEMINI_API_KEY is not configured or using placeholder in .env. Please add your Gemini API key to .env to chat with DukaanDost. You can still run automated tests with 'npm test' or database seed with 'npm run seed'.",
        toolCallsMade: []
      };
    }

    const toolCallsMade = [];
    let iterations = 0;

    // Helper to send message with retry and fallback
    const sendWithRetry = async (payload, maxRetries = 2) => {
      let lastErr = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await this.chatSession.sendMessage(payload);
        } catch (err) {
          lastErr = err;
          const msg = (err.message || '').toLowerCase();

          // If the model is experiencing high demand (503 / UNAVAILABLE) or 404
          if (msg.includes('503') || msg.includes('unavailable') || msg.includes('high demand') || msg.includes('404')) {
            if (this.activeModel === 'gemini-3.8-flash') {
              // Try fallback to gemini-3.8-flash so user is never blocked
              try {
                this.initGeminiClient('gemini-3.8-flash');
                return await this.chatSession.sendMessage(payload);
              } catch (fallbackErr) {
                lastErr = fallbackErr;
              }
            }
          }

          if (attempt < maxRetries && (msg.includes('429') || msg.includes('503') || msg.includes('quota') || msg.includes('timeout'))) {
            // Respect retryDelay from the error if present, capped at 60 seconds
            let delay = (attempt + 1) * 1500;
            const retryMatch = (err.message || '').match(/retry[_\s-]?(?:after|delay)[:\s]+(\d+)/i);
            if (retryMatch) {
              delay = Math.min(Number(retryMatch[1]) * 1000, 60000);
            }
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          break;
        }
      }
      throw lastErr;
    };

    try {
      let responseResult = await sendWithRetry({ message: userMessage });

      // Function-calling loop
      while (iterations < this.maxIterations) {
        iterations++;
        const functionCalls = responseResult.functionCalls;

        if (!functionCalls || functionCalls.length === 0) {
          break;
        }

        const functionResponses = [];
        for (const call of functionCalls) {
          const callName = call.name;
          const callArgs = call.args || {};

          const toolOutput = this.executeTool(callName, callArgs);
          toolCallsMade.push({
            tool: callName,
            args: callArgs,
            output: toolOutput
          });

          functionResponses.push({
            functionResponse: {
              name: callName,
              response: { result: toolOutput }
            }
          });
        }

        responseResult = await sendWithRetry({ message: functionResponses });
      }

      const finalReply = responseResult.text || "Namaste! I've processed your request.";
      return {
        reply: finalReply,
        toolCallsMade
      };
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      
      // Friendly message for rate limits (429 or RESOURCE_EXHAUSTED)
      if (msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota') || msg.includes('rate limit')) {
        return {
          reply: 'The store assistant is busy right now (API rate limit). Please wait about 30 seconds and try again.',
          toolCallsMade
        };
      }
      
      return {
        reply: `DukaanDost encountered an issue: ${err.message}. Please try again.`,
        toolCallsMade
      };
    }
  }

  /**
   * Resets the agent's memory and starts a fresh conversation.
   */
  reset() {
    resetTurn();
    if (this.isConfigured) {
      this.initGeminiClient();
    }
  }
}

module.exports = {
  DukaanDostAgent,
  toolRegistry
};
