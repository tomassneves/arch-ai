// ai-learner.js - Dynamic learning system
// When the parser does not recognize something, query an external LLM to learn

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'learning-db.json');
const CONFIG_PATH = path.join(__dirname, '..', 'client', 'src', 'engine', 'objects-config.json');

// Load learning database
function loadDB() {
  try {
    const content = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return { learned_objects: {}, interaction_log: [] };
  }
}

// Save learning database
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

// Load objects-config.json
function loadConfig() {
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return {};
  }
}

// Save updated config
function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Query Ollama LLM to learn about unknown object
 * Uses local Ollama server to generate geometric decomposition
 * 
 * @param {string} conceptName - e.g., "tree", "chair", "tower"
 * @returns {Promise<Object|null>} - Geometric decomposition or null
 */
async function queryExternalAI(conceptName) {
  
  const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
  const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
  
  // Check if Ollama is available
  try {
    const healthCheck = await fetch(`${OLLAMA_URL}/api/tags`, { 
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    if (!healthCheck.ok) {
      console.error('⚠️ Ollama is not available');
      return null;
    }
  } catch (err) {
    console.error('⚠️ Ollama is not running:', err.message);
    return null;
  }
  
  // Improved prompt emphasizing COMPLETE objects with better structure
  const prompt = `You are an expert 3D architect. Create a realistic 3D model of a "${conceptName}" using simple primitives.

KEY REQUIREMENTS:
1. COMPLETE & REALISTIC - Include ALL essential parts for a recognizable ${conceptName}
2. PROPER PROPORTIONS - Make parts appropriately sized (height 0.5-2, width 0.5-1.5)
3. CLEAR VERTICAL STRUCTURE - Stack parts vertically when appropriate (use y offset)
4. DISTINCT PARTS - Use different shapes to create visual interest
5. CENTERED - Use positive X and Z offsets to place parts around center

EXAMPLES FOR DIFFERENT CONCEPTS:
- TORRE (tower): Large vertical cylinder (diameter 0.8, height 2.5) as base + cone roof (diameter 0.9, height 0.6) on top + 2-4 small details
- CADEIRA (chair): Wide base cube (1x0.3x1) + backrest (0.8x1.5x0.1 offset y:1.2) + 4 leg cylinders at corners
- MESA (table): Large rectangular top (1.5x0.1x1) + 4 leg cylinders (diameter 0.15, height 1) at corners
- ARVORE (tree): Tree trunk cylinder (0.4 diameter, 2 height) + 2-3 spheres stacked for canopy

Available primitives: cube, cylinder, sphere, cone

Parameters:
- cube: {width, height, depth} OR {size}
- cylinder: {diameter, height}
- sphere: {radius}
- cone: {diameter, height}

Offset: {x, y, z} (y=up axis, positive y goes up)

Respond with ONLY valid JSON (no markdown, no explanations):
{
  "composition": [
    {"type": "cylinder", "params": {"diameter": 0.8, "height": 2.5}, "offset": {"x": 0, "y": 0, "z": 0}},
    {"type": "cone", "params": {"diameter": 0.9, "height": 0.6}, "offset": {"x": 0, "y": 2.5, "z": 0}},
    ... include 4-8 parts total
  ],
  "description": "Realistic ${conceptName}",
  "keywords": ["${conceptName}", "${conceptName}s"]
}`;
  
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.5,  // Balanced - enough creativity for realistic objects
          num_predict: 800   // Allow longer responses
        }
      }),
      signal: AbortSignal.timeout(30000)  // 30s timeout
    });
    
    if (!response.ok) {
      console.error('Ollama API error:', response.status);
      return null;
    }
    
    const data = await response.json();
    const generatedText = data.response || '';
    
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = generatedText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/) || jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }
    
    const parsed = JSON.parse(jsonStr);
    
    // Validation
    if (!parsed.composition || !Array.isArray(parsed.composition) || parsed.composition.length === 0) {
      console.error('Invalid composition from Ollama');
      return null;
    }
    
    // Show structure
    parsed.composition.forEach((part, i) => {
      const params = Object.entries(part.params).map(([k,v]) => `${k}:${v}`).join(', ');
      const offset = part.offset ? `@(${part.offset.x},${part.offset.y},${part.offset.z})` : '@(0,0,0)';
    });
    return parsed;
    
  } catch (err) {
    console.error('Error querying Ollama:', err.message);
    return null;
  }
  
  // If execution reaches here, it really doesn't know
  return null;
}

/**
 * Refine object definition based on user feedback
 * Takes current composition and user feedback, queries Ollama for improved version
 * 
 * @param {string} conceptName - e.g., "castelo"
 * @param {Array} currentComposition - Current parts of the object
 * @param {string} userFeedback - e.g., "missing a drawbridge"
 * @returns {Promise<Object|null>} - Improved definition or null
 */
export async function refineWithFeedback(conceptName, currentComposition, userFeedback) {
  
  const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
  const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
  
  // Check if Ollama is available
  try {
    const healthCheck = await fetch(`${OLLAMA_URL}/api/tags`, { 
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    if (!healthCheck.ok) {
      console.error('⚠️ Ollama is not available');
      return null;
    }
  } catch (err) {
    console.error('⚠️ Ollama is not running:', err.message);
    return null;
  }
  
  // Build prompt with current composition and feedback
  const currentParts = currentComposition.map((part, i) => 
    `Part ${i+1}: ${part.type} ${JSON.stringify(part.params)} at offset ${JSON.stringify(part.offset || {x:0,y:0,z:0})}`
  ).join('\\n');
  
  const prompt = `You are a 3D geometry expert improving a "${conceptName}".

CURRENT COMPOSITION (${currentComposition.length} parts):
${currentParts}

USER FEEDBACK: "${userFeedback}"

IMPORTANT: You MUST modify the composition based on the feedback. Do NOT return the same composition.

TASK: Create an IMPROVED version that:
1. INCORPORATES the user's feedback (this is mandatory)
2. MODIFIES or ADDS or REMOVES parts to address the feedback
3. Results in a BETTER and MORE COMPLETE ${conceptName}
4. Returns a DIFFERENT composition than what was given

Available primitives: cube, cylinder, sphere, cone

Parameters:
- cube: {width, height, depth} OR {size}
- cylinder: {diameter, height}
- sphere: {radius}
- cone: {diameter, height}

Offset: {x, y, z} relative to center point

Respond ONLY with valid JSON (no markdown):
{
  "composition": [
    {"type": "cylinder", "params": {...}, "offset": {...}},
    ...
  ],
  "description": "Brief description of improvements made",
  "keywords": ["${conceptName}"]
}`;
  
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,  // Increased for more creative improvements
          num_predict: 1000  // Allow longer responses
        }
      }),
      signal: AbortSignal.timeout(40000)  // 40s timeout for complex improvements
    });
    
    if (!response.ok) {
      console.error('Ollama API error:', response.status);
      return null;
    }
    
    const data = await response.json();
    const generatedText = data.response || '';
    
    
    // Extract JSON from response
    let jsonStr = generatedText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/) || jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }
    
    
    const parsed = JSON.parse(jsonStr);
    
    
    // Validation
    if (!parsed.composition || !Array.isArray(parsed.composition) || parsed.composition.length === 0) {
      console.error('Invalid composition from Ollama');
      return null;
    }
    
    
    // DEBUG: Show first part of new composition
    if (parsed.composition.length > 0) {
    }
    
    // Save improved version to database
    const db = loadDB();
    db.learned_objects[conceptName] = {
      ...parsed,
      learned_at: new Date().toISOString(),
      refined: true,
      feedback: userFeedback,
      usage_count: 0
    };
    
    db.interaction_log.push({
      timestamp: new Date().toISOString(),
      action: 'refined',
      concept: conceptName,
      feedback: userFeedback,
      parts_before: currentComposition.length,
      parts_after: parsed.composition.length,
      success: true
    });
    
    saveDB(db);
    
    // Update objects-config.json
    const config = loadConfig();
    const objectKey = conceptName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    
    config[objectKey] = {
      pt: parsed.keywords.filter(k => /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(k) || !k.match(/[a-z]/i)),
      en: parsed.keywords.filter(k => /^[a-z]+$/i.test(k)),
      composition: parsed.composition,
      description: parsed.description,
      builder: 'addComposite'
    };
    
    saveConfig(config);
    
    return parsed;
    
  } catch (err) {
    console.error('Error refining with Ollama:', err.message);
    return null;
  }
}

/**
 * Learn about a new concept and update the config
 * @param {string} conceptName - User's input (e.g., "árvore")
 * @returns {Promise<Object|null>} - Learned definition or null
 */
export async function learnNewConcept(conceptName) {
  const db = loadDB();
  
  // Check if already learned
  if (db.learned_objects[conceptName]) {
    return db.learned_objects[conceptName];
  }
  
  // Query external AI
  const aiResponse = await queryExternalAI(conceptName);
  if (!aiResponse) return null;
  
  // Save to learning database
  db.learned_objects[conceptName] = {
    ...aiResponse,
    learned_at: new Date().toISOString(),
    usage_count: 0
  };
  
  db.interaction_log.push({
    timestamp: new Date().toISOString(),
    action: 'learned',
    concept: conceptName,
    success: true
  });
  
  saveDB(db);
  
  // Update objects-config.json
  const config = loadConfig();
  const objectKey = conceptName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  
  config[objectKey] = {
    pt: aiResponse.keywords.filter(k => /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(k) || !k.match(/[a-z]/i)),
    en: aiResponse.keywords.filter(k => /^[a-z]+$/i.test(k)),
    composition: aiResponse.composition,
    description: aiResponse.description,
    builder: 'addComposite' // special builder for composite objects
  };
  
  saveConfig(config);
  
  return db.learned_objects[conceptName];
}

/**
 * Force re-learning of a concept (even if it already exists)
 * Useful for fixing incomplete or incorrect objects
 */
export async function forceRelearn(conceptName) {
  const db = loadDB();
  
  // Remove existing definition
  if (db.learned_objects[conceptName]) {
    delete db.learned_objects[conceptName];
    saveDB(db);
  }
  
  // Query AI again
  const aiResponse = await queryExternalAI(conceptName);
  if (!aiResponse) return null;
  
  // Save to learning database
  db.learned_objects[conceptName] = {
    ...aiResponse,
    learned_at: new Date().toISOString(),
    relearned: true,
    usage_count: 0
  };
  
  db.interaction_log.push({
    timestamp: new Date().toISOString(),
    action: 'relearned',
    concept: conceptName,
    success: true
  });
  
  saveDB(db);
  
  // Update objects-config.json
  const config = loadConfig();
  const objectKey = conceptName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  
  config[objectKey] = {
    pt: aiResponse.keywords.filter(k => /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(k) || !k.match(/[a-z]/i)),
    en: aiResponse.keywords.filter(k => /^[a-z]+$/i.test(k)),
    composition: aiResponse.composition,
    description: aiResponse.description,
    builder: 'addComposite'
  };
  
  saveConfig(config);
  
  return db.learned_objects[conceptName];
}

/**
 * Log user interaction for future fine-tuning
 */
export function logInteraction(text, spec, userFeedback = null) {
  const db = loadDB();
  db.interaction_log.push({
    timestamp: new Date().toISOString(),
    input: text,
    output_spec: spec,
    feedback: userFeedback
  });
  
  // Keep only last 1000 interactions
  if (db.interaction_log.length > 1000) {
    db.interaction_log = db.interaction_log.slice(-1000);
  }
  saveDB(db);
}

/**
 * Forget a learned concept - remove it from database
 * Allows re-learning with improved prompts
 */
export function forgetConcept(conceptName) {
  const db = loadDB();
  
  if (!db.learned_objects[conceptName]) {
    return false; // Concept doesn't exist
  }
  
  delete db.learned_objects[conceptName];
  saveDB(db);
  
  // Also remove from config
  const config = loadConfig();
  const objectKey = conceptName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (config[objectKey]) {
    delete config[objectKey];
    saveConfig(config);
  }
  
  return true;
}

/**
 * Get statistics about learned concepts
 */
export function getLearningStats() {
  const db = loadDB();
  return {
    total_learned: Object.keys(db.learned_objects).length,
    total_interactions: db.interaction_log.length,
    learned_concepts: Object.keys(db.learned_objects)
  };
}

/**
 * Extract concept name from user text (normalize and simplify)
 * "modern house" -> "modern_house"
 * "casa moderna" -> "casa_moderna"
 */
export function extractConceptName(text) {
  return text.toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // remove punctuation
    .replace(/\s+/g, '_'); // spaces to underscores
}

/**
 * Get learned concept by name (if exists)
 * Returns the composition and metadata
 */
export function getLearnedConcept(conceptName) {
  const db = loadDB();
  const normalized = extractConceptName(conceptName);
  
  // Try exact match first
  if (db.learned_objects[normalized]) {
    return {
      found: true,
      conceptName: normalized,
      ...db.learned_objects[normalized]
    };
  }
  
  // Try variations (plurals, without spaces, etc)
  const keys = Object.keys(db.learned_objects);
  for (const key of keys) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return {
        found: true,
        conceptName: key,
        ...db.learned_objects[key]
      };
    }
  }
  
  return { found: false };
}

/**
 * Validate composition quality to prevent saving broken/useless compositions
 * Checks for common issues like all parts at same position
 */
function isCompositionValid(composition) {
  if (!Array.isArray(composition) || composition.length === 0) {
    console.warn('Composition validation failed: empty or not an array');
    return false;
  }
  
  // Check if too many parts have the exact same position (indicates bad generation)
  const positionMap = new Map();
  for (const part of composition) {
    const x = part.x || 0;
    const y = part.y || 0;
    const z = part.z || 0;
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
    positionMap.set(key, (positionMap.get(key) || 0) + 1);
  }
  
  // If more than 80% of parts are at the same position, reject
  const maxAtSamePosition = Math.max(...positionMap.values());
  const percentageAtSamePosition = (maxAtSamePosition / composition.length) * 100;
  
  if (percentageAtSamePosition > 80) {
    console.warn(`Composition validation failed: ${percentageAtSamePosition.toFixed(0)}% of parts at same position`);
    return false;
  }
  
  // Check that parts have valid types
  const validTypes = ['wall', 'cylinder', 'cube', 'triangle', 'sphere', 'cone', 'torus', 'box', 'capsule'];
  const hasValidTypes = composition.every(part => validTypes.includes(part.type));
  
  if (!hasValidTypes) {
    console.warn('Composition validation failed: contains invalid part types');
    return false;
  }
  
  return true;
}

/**
 * Save improved version of a concept
 * Increments improvement_count and updates composition
 */
export function saveImprovedConcept(conceptName, newComposition, originalType) {
  const db = loadDB();
  const normalized = extractConceptName(conceptName);
  
  // Validate composition quality before saving
  if (!isCompositionValid(newComposition)) {
    console.warn(`⚠️ Rejecting invalid composition for "${normalized}" - quality check failed`);
    // Don't save, just return current iteration count
    const existing = db.learned_objects[normalized];
    return existing ? (existing.improvement_count || 0) : 0;
  }
  
  const existing = db.learned_objects[normalized];
  const improvementCount = existing ? (existing.improvement_count || 0) + 1 : 1;
  
  db.learned_objects[normalized] = {
    composition: newComposition,
    type: originalType || normalized,
    description: existing?.description || `Generated from: ${conceptName}`,
    keywords: [normalized],
    learned_at: existing?.learned_at || new Date().toISOString(),
    last_improved: new Date().toISOString(),
    improvement_count: improvementCount,
    usage_count: (existing?.usage_count || 0) + 1
  };
  
  db.interaction_log.push({
    timestamp: new Date().toISOString(),
    action: improvementCount > 1 ? 'improved' : 'learned',
    concept: normalized,
    improvement_count: improvementCount
  });
  
  saveDB(db);
  
  console.log(`💾 Saved improved version of "${normalized}" (iteration ${improvementCount})`);
  
  return improvementCount;
}

/**
 * Save feedback rating for a concept
 * Helps track quality of generated objects over time
 */
export function saveFeedbackRating(conceptName, rating, feedbackText, composition) {
  const db = loadDB();
  const normalized = extractConceptName(conceptName);
  
  // Find or create concept entry
  if (!db.learned_objects[normalized]) {
    console.warn(`⚠️ Concept "${normalized}" not found when saving rating`);
    return;
  }
  
  // Initialize feedback history if not exists
  if (!db.learned_objects[normalized].feedback_history) {
    db.learned_objects[normalized].feedback_history = [];
  }
  
  // Add rating to history
  db.learned_objects[normalized].feedback_history.push({
    timestamp: new Date().toISOString(),
    rating: rating, // 'positive' or 'negative'
    feedback: feedbackText || '',
    parts_count: composition.length,
    improvement_iteration: db.learned_objects[normalized].improvement_count || 1
  });
  
  // Update aggregate stats
  const history = db.learned_objects[normalized].feedback_history;
  const positiveCount = history.filter(f => f.rating === 'positive').length;
  const negativeCount = history.filter(f => f.rating === 'negative').length;
  const totalRatings = positiveCount + negativeCount;
  
  db.learned_objects[normalized].quality_stats = {
    positive_ratings: positiveCount,
    negative_ratings: negativeCount,
    total_ratings: totalRatings,
    satisfaction_rate: totalRatings > 0 ? (positiveCount / totalRatings * 100).toFixed(1) + '%' : 'N/A',
    last_rating: rating,
    last_rated: new Date().toISOString()
  };
  
  saveDB(db);
  
  const emoji = rating === 'positive' ? '👍' : '👎';
  console.log(`${emoji} Saved ${rating} rating for "${normalized}" (${positiveCount}+ / ${negativeCount}-)`);
}

