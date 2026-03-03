// claude-provider.js - Claude API integration for architecture generation

/**
 * Robust JSON parser with repair capabilities for malformed LLM output
 * @param {string} jsonText - Potentially malformed JSON string
 * @param {string} source - Source of the JSON for logging
 * @returns {object} - Parsed JSON object
 */
function parseAndRepairJSON(jsonText, source) {
  // First attempt: try direct parsing
  try {
    const parsed = JSON.parse(jsonText);
    console.log(`✓ JSON parsed successfully from ${source}`);
    console.log(`  Structure: type=${parsed.type || 'none'}, hasComposition=${!!parsed.composition}, compositionLength=${parsed.composition?.length || 0}`);
    return parsed;
  } catch (firstError) {
    console.warn(`⚠️ Initial JSON parse failed in ${source}:`, firstError.message);
  }

  // Second attempt: Handle truncation - find last valid closing bracket/brace
  if (!jsonText.endsWith('}') && !jsonText.endsWith(']')) {
    console.warn('⚠️ JSON appears truncated, attempting recovery...');
    
    const lastValidBrace = jsonText.lastIndexOf('}');
    const lastValidBracket = jsonText.lastIndexOf(']');
    const cutPoint = Math.max(lastValidBrace, lastValidBracket);
    
    if (cutPoint > 0) {
      const truncated = jsonText.substring(0, cutPoint + 1);
      try {
        return JSON.parse(truncated);
      } catch (truncError) {
        console.warn('⚠️ Truncation recovery failed:', truncError.message);
      }
    }
  }

  // Third attempt: Handle common JSON errors
  let repaired = jsonText;
  
  // Remove trailing commas in arrays/objects
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');
  
  // Fix missing commas between array elements (common LLM error)
  repaired = repaired.replace(/}\s*{/g, '},{');
  
  // Remove any trailing incomplete objects/arrays
  const matches = repaired.match(/\{[^}]*$|\[[^\]]*$/);
  if (matches) {
    repaired = repaired.substring(0, matches.index);
    // Ensure proper closing
    const openBraces = (repaired.match(/{/g) || []).length;
    const closeBraces = (repaired.match(/}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    
    repaired += ']'.repeat(Math.max(0, openBrackets - closeBrackets));
    repaired += '}'.repeat(Math.max(0, openBraces - closeBraces));
  }
  
  try {
    const result = JSON.parse(repaired);
    console.log(`✓ JSON repair successful in ${source}`);
    return result;
  } catch (repairError) {
    // Final attempt: extract composition array if it exists
    const compositionMatch = repaired.match(/"composition"\s*:\s*(\[[^\]]*\])/);
    if (compositionMatch) {
      try {
        const composition = JSON.parse(compositionMatch[1]);
        console.log(`✓ Extracted composition array (${composition.length} parts)`);
        return { type: 'composite', composition };
      } catch (e) {
        // Fall through to error
      }
    }
    
    // All repair attempts failed
    console.error('❌ All JSON repair attempts failed');
    console.error('First 500 chars:', jsonText.substring(0, 500));
    console.error('Last 500 chars:', jsonText.substring(Math.max(0, jsonText.length - 500)));
    throw new Error(`Failed to parse JSON from ${source}: ${repairError.message}. JSON may be too malformed to recover.`);
  }
}

/**
 * Call Claude API with architecture-specific prompt
 * @param {string} userPrompt - User's natural language request
 * @param {object} objectDefs - Available object types from config
 * @returns {Promise<object>} - Parsed architecture specification
 */
export async function generateWithClaude(userPrompt, objectDefs) {
  const apiKey = process.env.CLAUDE_API_KEY;
  
  if (!apiKey || apiKey === 'sk-ant-api03-your-key-here') {
    throw new Error('Claude API key not configured. Set CLAUDE_API_KEY in .env file');
  }

  const model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20240620';
  
  // Restrict to primitive types that are fully supported by engine commands
  const allowedTypes = ['wall', 'cylinder', 'cube', 'triangle', 'sphere', 'cone', 'torus', 'box', 'capsule', 'arch', 'pitched_roof', 'dome', 'stairs', 'column_with_capital', 'bezier_surface'];
  const availableTypes = allowedTypes.join(', ');
  
  const systemPrompt = `You are a specialist assistant in generating ultra-precise 3D specifications for ANY object.
Your mission is to create geometric compositions with an unprecedented level of detail and precision.

═══════════════════════════════════════════════════════════
AVAILABLE PRIMITIVES: ${availableTypes}
═══════════════════════════════════════════════════════════

📐 SPECIFICATIONS FOR EACH PRIMITIVE:

1. WALL (walls, panels, flat surfaces)
   - width: width (meters)
   - height: height (meters)
   - depth: thickness (meters, normally 0.1 to 0.3)
   - rotation: rotation in degrees (optional, 0-360)

2. CYLINDER (cylinders, columns, tubes, wheels)
   - diameter: diameter (meters)
   - height: height (meters)

3. CUBE (boxes, cubic blocks)
   - size: cube side size (meters)

4. TRIANGLE (triangles, roofs, arrows)
   - size: base size (meters)

5. SPHERE (spheres, balls)
   - radius: radius (meters)

6. CONE (cones, hats, tips)
   - radius: base radius (meters)
   - height: height (meters)

7. TORUS (wheels, tires, donuts, rings) ⭐ PERFECT FOR WHEELS!
   - outerRadius: outer radius (meters)
   - tubeRadius: tube radius (meters, thickness)
   - axis: orientation axis ('x', 'y', 'z') - use 'x' for horizontal wheels!

8. BOX (rectangular boxes, car bodies) ⭐ BETTER THAN CUBE!
   - width: width (meters)
   - height: height (meters)
   - depth: depth (meters)

9. CAPSULE (rounded cylinders, smooth shapes)
   - radius: radius (meters)
   - length: total length (meters)
   - axis: axis ('x', 'y', 'z')

10. ARCH (arches, vaults, curved openings) ⭐ ARCHITECTURAL!
   - radius: arch radius (meters, typically 1.5 to 3)
   - thickness: arch thickness (meters, typically 0.2 to 0.5)
   - archType: 'semicircle' (90°), 'pointed' (120°), or 'segmental' (60°)

11. PITCHED_ROOF (triangular roofs, gables) ⭐ ARCHITECTURAL!
   - width: roof width (meters)
   - depth: roof depth (meters)
   - height: peak height (meters, typically 0.5 to 2)

12. DOME (hemispherical structures, cupolas) ⭐ ARCHITECTURAL!
   - radius: dome radius (meters, typically 1 to 4)

13. STAIRS (staircases with railings) ⭐ ARCHITECTURAL!
   - width: stair width (meters)
   - stepCount: number of steps (typically 4 to 12)
   - stepHeight: height per step (meters, typically 0.3 to 0.4)
   - stepDepth: depth per step (meters, typically 0.3 to 0.4)

14. COLUMN_WITH_CAPITAL (decorative columns) ⭐ ARCHITECTURAL!
   - diameter: column diameter (meters, typically 0.3 to 0.6)
   - height: column height (meters, typically 2 to 5)
   - capitalStyle: 'doric' (simple), 'ionic' (curved), or 'corinthian' (ornate)

15. BEZIER_SURFACE (curved parametric surfaces) ⭐ PRECISION CURVES!
   - controlGrid: 2D array of [x,y,z] control points (e.g., 3x3 grid = 9 points)
   - segments: surface subdivisions (typically 15-30 for smooth rendering)
   - Used for: vaults, curved walls, organic stone shapes, sagging arches, deformed surfaces
   - Example controlGrid for simple curved panel:
     [[[0,0,0], [1,0,0], [2,0,0]],
      [[0,1,0.5], [1,1,1.5], [2,1,0.5]],
      [[0,2,0], [1,2,0], [2,2,0]]]

═══════════════════════════════════════════════════════════
🎨 AVAILABLE COLORS
═══════════════════════════════════════════════════════════

Each part can have a color! Use the "color" parameter with:
- Portuguese names: vermelho, verde, azul, amarelo, preto, branco, cinza, laranja, roxo, rosa, castanho
- English names: red, green, blue, yellow, black, white, gray, orange, purple, pink, brown
- Hex codes: "#ff0000" or "ff0000" for red

Examples:
  { "type": "sphere", "radius": 1, "color": "red", "x": 0, "y": 0, "z": 0 }
  { "type": "cube", "size": 2, "color": "#00ff00", "x": 1, "y": 0, "z": 0 }
  { "type": "wall", "width": 5, "height": 2, "color": "gray", "x": 0, "y": 1, "z": 0 }

═══════════════════════════════════════════════════════════
🎯 COORDINATE SYSTEM
═══════════════════════════════════════════════════════════

Use 3D coordinates to position EACH part with precision:
- x: left(-) / right(+)
- y: down(-) / up(+) [y=0 is the ground]
- z: front(+) / back(-)

ATTENTION: y=0 is the GROUND. To stack, sum the heights!
Example: cylinder with height 2 at y=0, next at y=2, next at y=4

═══════════════════════════════════════════════════════════
🏗️ COMPOSITION RULES
═══════════════════════════════════════════════════════════

1. Use up to 100 parts for complex objects
2. Position each part with precise x,y,z coordinates
3. Realistic dimensions (in meters)
4. For symmetric objects, maintain coordinate symmetry
5. For objects with wheels, use cylinders with small diameter and height (wheels are flat)
6. For car bodies, use walls and cubes combined
7. For fine details, use small dimensions (0.1, 0.2, etc)
8. ⚠️ ABSOLUTE MAXIMUM: 50 parts - prioritize quality over quantity

═══════════════════════════════════════════════════════════
💡 EXAMPLES OF COMPLEX OBJECTS
═══════════════════════════════════════════════════════════

⭐ CAR (improved example):
- Car body: BOX (width:4, height:1.2, depth:2, color:"red") at y=0.6
- Cabin: BOX (width:2.5, height:0.8, depth:1.8, color:"red") at y=1.4
- Wheels: 4 TORUS (outerRadius:0.35, tubeRadius:0.15, axis:'x', color:"black")
  - Positions: x=±1, z=±1.2, y=0.35
- Bumpers: Small BOX (width:4.2, height:0.2, depth:0.3, color:"gray")
- Windows: Thin WALL (color:"blue") on the sides
- Headlights: Small SPHERE (radius:0.1, color:"yellow")

HOUSE (example):
- 4 walls for walls (use rotation: 90 for perpendicular walls)
- Cone or triangle for roof
- Small walls for windows/doors (or leave gaps)

═══════════════════════════════════════════════════════════
📋 OUTPUT FORMAT
═══════════════════════════════════════════════════════════

Return ONLY valid JSON, no markdown, no explanations.

Simple object:
{
  "type": "cylinder",
  "diameter": 1,
  "height": 2,
  "x": 0,
  "y": 0,
  "z": 0
}

Composite object (ALWAYS use for complex objects):
{
  "type": "car",
  "composition": [
    { "type": "cube", "size": 2, "x": 0, "y": 0.5, "z": 0 },
    { "type": "cylinder", "diameter": 0.5, "height": 0.2, "x": -0.8, "y": 0.1, "z": 1 },
    { "type": "cylinder", "diameter": 0.5, "height": 0.2, "x": 0.8, "y": 0.1, "z": 1 },
    { "type": "cylinder", "diameter": 0.5, "height": 0.2, "x": -0.8, "y": 0.1, "z": -1 },
    { "type": "cylinder", "diameter": 0.5, "height": 0.2, "x": 0.8, "y": 0.1, "z": -1 }
  ]
}

═══════════════════════════════════════════════════════════
⚡ FINAL INSTRUCTIONS
═══════════════════════════════════════════════════════════

- Be detailed but CONCISE
- Use 15-40 parts for complex objects (MAXIMUM 50 parts)
- Think about the real proportions of the object
- Position each element with exact coordinates
- For vehicles: always include wheels, car body, windows
- For buildings: always include walls, ceiling, base
- Use rotation when necessary (perpendicular walls)

IMPORTANT: Keep the JSON compact and valid. Avoid excessive complexity.
═══════════════════════════════════════════════════════════`;

  const userMessage = `Generate the 3D specification for: ${userPrompt}

Return ONLY JSON, with no markdown or explanations.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4000,
        temperature: 0.1,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userMessage
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.content || !data.content[0]) {
      throw new Error('Invalid response from Claude API');
    }

    const textContent = data.content[0].text.trim();
    
    console.log(`📥 Received ${textContent.length} chars from Claude`);

    let jsonText = textContent;
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    
    // Try parsing the JSON with robust error handling
    const parsed = parseAndRepairJSON(jsonText, 'generateWithClaude');
    
    // Final validation: ensure it has content
    if (!parsed) {
      throw new Error('Claude returned null/undefined response after parsing');
    }
    
    return parsed;
    
  } catch (error) {
    console.error('❌ Claude API error:', error.message);
    throw error;
  }
}

/**
 * Refine/improve existing object based on user feedback
 * @param {string} objectName - Name of the object being improved
 * @param {Array} currentComposition - Current parts of the object
 * @param {string} userFeedback - User's request (e.g., "adicionar antena", "aumentar altura")
 * @returns {Promise<object>} - Improved specification
 */
export async function refineWithClaude(objectName, currentComposition, userFeedback, rating = null) {
  const apiKey = process.env.CLAUDE_API_KEY;
  
  if (!apiKey || apiKey === 'sk-ant-api03-your-key-here') {
    throw new Error('Claude API key not configured. Set CLAUDE_API_KEY in .env file');
  }

  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  
  // Build quality context based on rating
  let qualityContext = '';
  if (rating === 'positive') {
    qualityContext = '\n\n✓ POSITIVE FEEDBACK: The user LIKED the result. Keep what works well and make only small adjustments.';
  } else if (rating === 'negative') {
    qualityContext = '\n\n✗ NEGATIVE FEEDBACK: The user DISLIKED the result. Make more substantial changes to significantly improve.';
  }
  
  const systemPrompt = `You are a specialist in improving 3D models based on user feedback.

IMPORTANT: You will receive an existing 3D object and an improvement request.
You MUST maintain the CHARACTER and ESSENCE of the original object while improving it.${qualityContext}

AVAILABLE PRIMITIVES: wall, cylinder, cube, triangle, sphere, cone, torus, box, capsule

AVAILABLE COLORS:
Each part can have a "color" property with names like: red, green, blue, yellow, black, white, gray, orange, purple, pink
Or use hex codes like "#ff0000"

CRITICAL RULES FOR IMPROVEMENTS:
1. MAINTAIN the base structure - preserve the main parts that define the object
2. IMPROVE proportions - adjust dimensions to be more realistic
3. ADD specific details - elements that make the object more recognizable
4. MAINTAIN existing colors unless feedback requests change
5. If improving automatically (without color feedback), maintain the color scheme
6. Return ONLY valid JSON, no markdown

FOR AUTOMATIC IMPROVEMENTS (not requested by user):
- Analyze the current object and identify what is missing
- Add parts that are ESSENTIAL for this type of object
- Adjust proportions for realism
- DO NOT completely change the design - just refine and add

FOR USER FEEDBACK:
- Request: "change color to pink" → return each part WITH "color": "pink"
- Request: "add antenna" → add new cylinder PLUS keep old parts
- Request: "increase height" → modify height in relevant parts

OUTPUT FORMAT:
{
  "type": "object_name",
  "composition": [
    ... improved parts (with adjusted dimensions/colors if applicable)
    ... newly added parts (details and features)
  ]
}`;

  const currentPartsStr = currentComposition.map((p, i) => {
    const dims = p.width ? `${p.width}x${p.height}x${p.depth}` : 
                 p.diameter ? `d=${p.diameter}` :
                 p.radius ? `r=${p.radius}` :
                 p.size ? `s=${p.size}` : '';
    const color = p.color ? ` color=${p.color}` : '';
    return `${i+1}. ${p.type} at pos=(${p.x},${p.y},${p.z}) ${dims}${color}`;
  }).join('\n');

  const userMessage = `Current object "${objectName}" with ${currentComposition.length} parts:
${currentPartsStr}

USER REQUEST: "${userFeedback}"

Improve the object as requested. Return the complete object (all old parts with changes + new parts) in pure JSON.
If the request mentions color, ALWAYS include the "color" property in relevant parts.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4000,
        temperature: 0.2,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userMessage
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.content || !data.content[0] || !data.content[0].text) {
      throw new Error('Claude returned empty response');
    }

    let responseText = data.content[0].text.trim();
    
    // Extract JSON from markdown code blocks if present
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      responseText = jsonMatch[1].trim();
    }
    
    // Use robust JSON parsing with repair
    const json = parseAndRepairJSON(responseText, 'refineWithClaude');

    return json;

  } catch (error) {
    console.error('❌ Error improving with Claude:', error);
    throw error;
  }
}

