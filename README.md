sed on original code by Andrej Karpathy. Enhancements and modifications by UnderPlayer673.
```markdown
# 🏛️ LLM Council: Enhanced Edition (by UnderPlayer)

*Based on the original weekend hack by [Andrej Karpathy](https://github.com/karpathy). Heavily modified, optimized, and expanded by UnderPlayer673.*

## 🚀 What's New in This Enhanced Edition?
The original project was a brilliant proof-of-concept, but it relied on expensive, premium APIs. I completely overhauled the architecture to make it robust, free-tier friendly, and localized:

* **⛓️ Dynamic Failover Chains:** Instead of single models, the Council uses "Teams" (Elite, Pro, Support). If a model hits a rate limit or API error, the system automatically falls back to the next available model in the chain.
* **💸 Free-Tier Optimization:** Fully integrated with free APIs via OpenRouter, Cerebras, and Google Gemini. You can run a massive AI council with a $0 budget.
* **🇷🇺 RU Localization & System Prompts:** Custom system prompts designed specifically for Russian-speaking users.
* **🎨 UI/UX Overhaul:** A redesigned, modern React interface with built-in settings, themes, and input debouncing (50ms) to prevent lag during fast typing.
* **⏱️ Strict Timeouts & Token Budgeting:** Custom logic to prevent endless thinking and context window overflow.

---

## 🧠 The Core Concept (How it works)
Instead of asking a question to a single LLM, you group them into an "LLM Council". The app sends your query to multiple LLMs, asks them to review and rank each other's work, and finally, a Chairman LLM produces the final response.

1. **Stage 1: First opinions**. The user query is given to all LLM Teams in parallel. The system uses failover logic to ensure every team provides an answer.
2. **Stage 2: Blind Review**. Each LLM is given the anonymized responses of the other LLMs (Response A, Response B, etc.). They evaluate and rank them to prevent brand bias.
3. **Stage 3: Final Synthesis**. The designated Chairman takes all responses and evaluations, then compiles them into a single, perfect final answer.

## 🛠️ Setup & Installation

### 1. Install Dependencies

**Backend:**
```bash
uv sync
```

**Frontend:**
```bash
cd frontend
npm install
cd ..
```

### 2. Configure API Keys
Create a `.env` file in the project root. *Note: You can use free models, but you still need to provide your own API keys (set to `null` in the code for security).*

```env
OPENROUTER_API_KEY=sk-or-v1-...
GOOGLE_API_KEY=AIzaSy...
CEREBRAS_API_KEY=csk-...
```

### 3. Run the Application

**Terminal 1 (Backend):**
```bash
uv run python -m backend.main
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm run dev
```
Then open `http://localhost:5173` in your browser.
Or in the project root directory you can run the command:
```bash
.\start.ps1
```

## 💻 Tech Stack
* **Backend:** FastAPI, async httpx (OpenRouter, Google, Cerebras)
* **Frontend:** React + Vite, TailwindCSS, SSE Streaming
* **Architecture:** Multi-Agent Consensus with Fallback/Failover routing.

---
*Original Vibe Code by Andrej Karpathy. Enhanced Engineering by UnderPlayer673.*
