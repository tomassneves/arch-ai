import { generateWithClaude, refineWithClaude } from './providers/claude-provider.js';
import { generateWithOpenAI, refineWithOpenAI } from './providers/openai-provider.js';
import { getLearnedConcept, saveImprovedConcept, extractConceptName, saveFeedbackRating } from './ai-learner.js';

const SUPPORTED_TYPES = new Set(['wall', 'cylinder', 'cube', 'triangle', 'sphere', 'cone', 'torus', 'box', 'capsule']);
const SUPPORTED_COLOR_NAMES = new Set([
  'vermelho', 'verde', 'azul', 'amarelo', 'preto', 'branco', 'cinza', 'laranja', 'roxo', 'rosa', 'castanho',
  'red', 'green', 'blue', 'yellow', 'black', 'white', 'gray', 'grey', 'orange', 'purple', 'pink', 'brown'
]);

function getProvider() {
  return (process.env.LLM_PROVIDER || 'claude').toLowerCase();
}

function normalizeColor(value) {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  const lower = raw.toLowerCase();
  if (SUPPORTED_COLOR_NAMES.has(lower)) return lower;

  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `#${hex.toLowerCase()}`;
  }

  return undefined;
}

function isTowerOfPisaRequest(text) {
  const lower = (text || '').toLowerCase();
  return /torre\s+(de|da)\s+(pisa|pizza)|leaning\s+tower\s+of\s+pisa/.test(lower);
}

function buildTowerOfPisaSpec() {
  const composition = [];
  composition.push({ type: 'cylinder', diameter: 6.6, height: 1.2, x: 0, y: 0, z: 0 });

  const levels = [
    { diameter: 5.6, height: 2.2 },
    { diameter: 5.3, height: 2.1 },
    { diameter: 5.0, height: 2.0 },
    { diameter: 4.7, height: 1.9 },
    { diameter: 4.4, height: 1.8 },
    { diameter: 4.1, height: 1.7 },
    { diameter: 3.8, height: 1.6 },
    { diameter: 3.5, height: 1.5 }
  ];

  let y = 1.2;
  let x = 0;
  for (const level of levels) {
    x += 0.15;
    composition.push({
      type: 'cylinder',
      diameter: level.diameter,
      height: level.height,
      x,
      y,
      z: 0
    });
    y += level.height;
  }

  composition.push({ type: 'cone', radius: 1.6, height: 1.2, x: x + 0.08, y, z: 0 });

  return {
    type: 'torre_de_pisa',
    composition
  };
}

function numberOrDefault(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sanitizePart(part) {
  if (!part || typeof part !== 'object') {
    console.warn('sanitizePart: part is not an object', typeof part);
    return null;
  }

  const type = typeof part.type === 'string' ? part.type.toLowerCase() : '';
  if (!SUPPORTED_TYPES.has(type)) {
    console.warn(`sanitizePart: unsupported type "${type}" (supported: ${Array.from(SUPPORTED_TYPES).join(', ')})`);
    return null;
  }

  const sanitized = { type };
  sanitized.x = numberOrDefault(part.x, 0);
  sanitized.y = numberOrDefault(part.y, 0);
  sanitized.z = numberOrDefault(part.z, 0);

  const normalizedColor = normalizeColor(part.color);
  if (normalizedColor) sanitized.color = normalizedColor;

  if (type === 'wall') {
    sanitized.width = Math.max(0.2, numberOrDefault(part.width, 4));
    sanitized.height = Math.max(0.2, numberOrDefault(part.height, 3));
    sanitized.depth = Math.max(0.05, numberOrDefault(part.depth, 0.2));
    if (part.rotation !== undefined) {
      sanitized.rotation = numberOrDefault(part.rotation, 0);
    }
  }

  if (type === 'cylinder') {
    const diameter = part.diameter ?? (part.radius ? Number(part.radius) * 2 : undefined);
    sanitized.diameter = Math.max(0.1, numberOrDefault(diameter, 1));
    sanitized.height = Math.max(0.1, numberOrDefault(part.height, 2));
  }

  if (type === 'cube') {
    sanitized.size = Math.max(0.1, numberOrDefault(part.size, 1));
  }

  if (type === 'triangle') {
    sanitized.size = Math.max(0.1, numberOrDefault(part.size, 1));
  }

  if (type === 'sphere') {
    sanitized.radius = Math.max(0.1, numberOrDefault(part.radius, 0.6));
  }

  if (type === 'cone') {
    const radius = part.radius ?? (part.diameter ? Number(part.diameter) / 2 : undefined);
    sanitized.radius = Math.max(0.1, numberOrDefault(radius, 0.8));
    sanitized.height = Math.max(0.1, numberOrDefault(part.height, 1.5));
  }

  if (type === 'torus') {
    sanitized.outerRadius = Math.max(0.1, numberOrDefault(part.outerRadius, 0.5));
    sanitized.tubeRadius = Math.max(0.05, numberOrDefault(part.tubeRadius, 0.15));
    if (part.axis) sanitized.axis = part.axis;
  }

  if (type === 'box') {
    sanitized.width = Math.max(0.1, numberOrDefault(part.width, 2));
    sanitized.height = Math.max(0.1, numberOrDefault(part.height, 1));
    sanitized.depth = Math.max(0.1, numberOrDefault(part.depth, 1));
  }

  if (type === 'capsule') {
    sanitized.radius = Math.max(0.05, numberOrDefault(part.radius, 0.3));
    sanitized.length = Math.max(0.2, numberOrDefault(part.length, 2));
    if (part.axis) sanitized.axis = part.axis;
  }

  return sanitized;
}

function sanitizeSpec(rawSpec) {
  if (Array.isArray(rawSpec)) {
    return rawSpec
      .map(sanitizePart)
      .filter(Boolean)
      .slice(0, 50);
  }

  if (!rawSpec || typeof rawSpec !== 'object') return null;

  if (Array.isArray(rawSpec.composition)) {
    const composition = rawSpec.composition
      .map(sanitizePart)
      .filter(Boolean)
      .slice(0, 50);

    if (composition.length === 0) return null;

    return {
      type: typeof rawSpec.type === 'string' ? rawSpec.type : 'composite',
      composition,
      x: numberOrDefault(rawSpec.x, 0),
      z: numberOrDefault(rawSpec.z, 0)
    };
  }

  return sanitizePart(rawSpec);
}

function requireSanitizedSpec(rawSpec, contextLabel) {
  const sanitized = sanitizeSpec(rawSpec);
  if (!sanitized) {
    // Provide detailed error message for debugging
    let reason = 'unknown';
    if (!rawSpec || typeof rawSpec !== 'object') {
      reason = 'rawSpec is not an object';
    } else if (Array.isArray(rawSpec)) {
      reason = `array had ${rawSpec.length} items but none were valid`;
    } else if (Array.isArray(rawSpec.composition)) {
      const validParts = rawSpec.composition.filter(p => sanitizePart(p) !== null).length;
      reason = `composition array has ${rawSpec.composition.length} parts but only ${validParts} are valid`;
    } else {
      reason = 'single object failed sanitization (type not supported or missing required fields)';
    }
    
    console.error(`❌ Sanitization failed: ${reason}`);
    console.error(`Raw spec type: ${typeof rawSpec}, isArray: ${Array.isArray(rawSpec)}`);
    if (rawSpec && typeof rawSpec === 'object') {
      console.error(`Raw spec keys: ${Object.keys(rawSpec).join(', ')}`);
      if (rawSpec.composition) {
        console.error(`Composition length: ${rawSpec.composition.length}`);
        console.error(`First part: ${JSON.stringify(rawSpec.composition[0])}`);
      }
    }
    
    throw new Error(`${contextLabel} returned invalid specification: ${reason}`);
  }
  return sanitized;
}

async function generateWithProvider(text) {
  const provider = getProvider();
  if (provider === 'openai') {
    return generateWithOpenAI(text);
  }
  if (provider === 'claude') {
    return generateWithClaude(text, {});
  }
  throw new Error(`Unsupported LLM_PROVIDER: ${provider}. Use "claude" or "openai".`);
}

async function refineWithProvider(objectName, currentComposition, userFeedback, rating = null) {
  const provider = getProvider();
  if (provider === 'openai') {
    return refineWithOpenAI(objectName, currentComposition, userFeedback, rating);
  }
  if (provider === 'claude') {
    return refineWithClaude(objectName, currentComposition, userFeedback, rating);
  }
  throw new Error(`Unsupported LLM_PROVIDER: ${provider}. Use "claude" or "openai".`);
}

export async function runModel(text) {
  const provider = getProvider();
  if (isTowerOfPisaRequest(text)) {
    return buildTowerOfPisaSpec();
  }

  try {
    // Check if we've learned about this concept before
    const conceptName = extractConceptName(text);
    const learned = getLearnedConcept(conceptName);
    
    let result;
    
    if (learned.found) {
      // We have a previous version - ask AI to improve it!
      const improvementCount = learned.improvement_count || 0;
      console.log(`📚 Found previous version of "${conceptName}" (iteration ${improvementCount}). Improving...`);
      
      // Context-aware improvement prompts based on iteration
      let improvementPrompt;
      if (improvementCount === 0) {
        // First improvement: Add essential missing features
        improvementPrompt = `This is the first version. Analyze what's missing to make this a recognizable, realistic ${conceptName}. Add 3-5 important details that define this object's identity (e.g., for a car: spoilers, mirrors, grilles, lights). Keep ALL existing parts but refine their shapes and proportions.`;
      } else if (improvementCount === 1) {
        // Second improvement: Refine proportions and add distinctive features
        improvementPrompt = `This is iteration 2. The basic structure exists. Now refine proportions to be more realistic and add 2-3 distinctive features that make this ${conceptName} unique and visually appealing. Improve symmetry and detail.`;
      } else {
        // Further improvements: Polish and add fine details
        improvementPrompt = `This is iteration ${improvementCount + 1}. Polish this ${conceptName} by: (1) adjusting 1-2 parts to have better proportions, (2) adding 1 small detail for realism. Keep the overall design intact - only subtle improvements.`;
      }
      
      result = await refineWithProvider(
        learned.type || conceptName,
        learned.composition,
        improvementPrompt
      );
    } else {
      // First time seeing this - generate fresh
      console.log(`🆕 First time generating "${conceptName}"`);
      result = await generateWithProvider(text);
    }
    
    const sanitized = requireSanitizedSpec(result, provider);
    
    // Save the improved version for next time
    const iterationCount = saveImprovedConcept(
      conceptName,
      sanitized.composition || [sanitized],
      sanitized.type
    );
    
    // Add metadata to response so frontend knows it's been improved
    if (sanitized.type) {
      sanitized._learningMeta = {
        iteration: iterationCount,
        isImprovement: learned.found
      };
    }
    
    return sanitized;
    
  } catch (error) {
    console.error(`✗ ${provider} generation failed:`, error.message);
    throw new Error(`Failed to generate 3D specification: ${error.message}`);
  }
}

export async function refineModel(objectName, currentComposition, userFeedback, rating = null) {
  const provider = getProvider();
  try {
    const result = await refineWithProvider(objectName, currentComposition, userFeedback, rating);
    
    // Save feedback with rating to learning system for future reference
    if (rating) {
      const conceptName = extractConceptName(objectName);
      const learned = getLearnedConcept(conceptName);
      if (learned.found) {
        // Update learning database with rating
        saveFeedbackRating(conceptName, rating, userFeedback, currentComposition);
      }
    }
    
    return requireSanitizedSpec(result, provider);
  } catch (error) {
    console.error(`✗ ${provider} refinement failed:`, error.message);
    throw new Error(`Failed to refine 3D specification: ${error.message}`);
  }
}
