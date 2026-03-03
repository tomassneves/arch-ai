// openai-provider.js - OpenAI API integration for architecture generation

function parseJsonFromText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('OpenAI returned empty content');
  }

  let jsonText = text.trim();

  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }

  const jsonMatch = jsonText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    jsonText = jsonMatch[0];
  }

  return JSON.parse(jsonText);
}

async function callOpenAI(systemPrompt, userPrompt, maxTokens = 4000) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-your-openai-key-here') {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in .env file');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return parseJsonFromText(content);
}

export async function generateWithOpenAI(userPrompt) {
  const systemPrompt = `You generate 3D specifications in JSON for these primitives: wall, cylinder, cube, triangle, sphere, cone, torus, box, capsule, arch, pitched_roof, dome, stairs, column_with_capital, bezier_surface.

Rules:
- Respond ONLY with valid JSON.
- For simple objects, return a single object with type and dimensions.
- For complex objects, return { "type": "name", "composition": [ ... ] }.
- Always include x,y,z in each part.
- If the user requests color, include "color" in each relevant part.
- Use realistic measurements in meters.
- Maximum 100 parts.`;

  const userMessage = `Generate the 3D specification for: ${userPrompt}`;
  return callOpenAI(systemPrompt, userMessage, 4000);
}

export async function refineWithOpenAI(objectName, currentComposition, userFeedback, rating = null) {
  // Build quality context based on rating
  let qualityContext = '';
  if (rating === 'positive') {
    qualityContext = '\n\n✓ USER LIKED IT: Keep what works well and make only minor adjustments.';
  } else if (rating === 'negative') {
    qualityContext = '\n\n✗ USER DISLIKED IT: Make substantial changes to significantly improve quality.';
  }
  
  const systemPrompt = `You improve existing 3D objects.${qualityContext}

Critical rules:
- Preserve existing parts, except when the change requires modifications.
- If the request mentions color, apply "color" to relevant parts.
- Return ONLY valid JSON in the format:
  { "type": "name", "composition": [ ... ] }
- Allowed primitives: wall, cylinder, cube, triangle, sphere, cone, torus, box, capsule, arch, pitched_roof, dome, stairs, column_with_capital, bezier_surface.`;

  const userMessage = `Current object "${objectName}":\n${JSON.stringify(currentComposition, null, 2)}\n\nUser request: "${userFeedback}"\n\nReturn the complete updated object.`;

  return callOpenAI(systemPrompt, userMessage, 4000);
}
