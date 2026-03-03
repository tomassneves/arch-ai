# Claude API Setup

## 1. Get API Key

Visit: https://console.anthropic.com/
1. Create account / Login
2. Go to "API Keys"
3. Create new key
4. Copy the key (starts with `sk-ant-api03-...`)

## 2. Configure

Edit `server/.env`:
```bash
# Change this:
CLAUDE_API_KEY=sk-ant-api03-your-key-here

# To your actual key:
CLAUDE_API_KEY=sk-ant-api03-actual-key-here
```

## 3. Test

Start the server and try:
- "criar uma casa com 2 quartos"
- "torre medieval com 3 andares"
- "ponte levadiça"

Claude will generate precise architectural specifications!

## Pricing

Claude 3.5 Sonnet:
- Input: $3 per 1M tokens
- Output: $15 per 1M tokens

**Typical usage:**
- ~500 tokens per request
- ~$0.01 per 20 generations
- Very affordable!

## Fallback

If Claude fails (no API key, network error), the system automatically falls back to local keyword matching.
