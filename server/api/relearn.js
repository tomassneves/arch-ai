// api/relearn.js - Force re-learning of incomplete or incorrect objects

import express from 'express';
import { forceRelearn } from '../ai-learner.js';

const router = express.Router();

/**
 * POST /api/relearn
 * Body: { concept: "chair" }
 * Forces the AI to re-learn a concept, even if it exists
 */
router.post('/', async (req, res) => {
  const { concept } = req.body;
  
  if (!concept || typeof concept !== 'string') {
    return res.status(400).json({ 
      ok: false, 
      error: 'Missing "concept" parameter' 
    });
  }
  
  try {
    const result = await forceRelearn(concept);
    
    if (result) {
      return res.json({ 
        ok: true, 
        message: `"${concept}" relearned successfully`,
        composition: result.composition,
        parts: result.composition.length
      });
    } else {
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to relearn concept' 
      });
    }
  } catch (err) {
    console.error('Relearn error:', err);
    return res.status(500).json({ 
      ok: false, 
      error: err.message 
    });
  }
});

export default router;
