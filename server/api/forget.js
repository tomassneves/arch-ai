import express from 'express';
import { forgetConcept } from '../ai-learner.js';

const router = express.Router();

/**
 * DELETE /api/forget/:conceptName
 * Remove a learned concept from the database
 * Allows re-learning the same concept with updated prompt
 */
router.delete('/:conceptName', async (req, res) => {
  const { conceptName } = req.params;

  if (!conceptName) {
    return res.status(400).json({ ok: false, error: 'conceptName required' });
  }

  try {
    const success = await forgetConcept(conceptName);
    if (success) {
      res.json({ 
        ok: true, 
        message: `Forgot "${conceptName}". You can create it again!` 
      });
    } else {
      res.status(400).json({ 
        ok: false, 
        error: `"${conceptName}" did not exist in the database` 
      });
    }
  } catch (err) {
    console.error('Error forgetting concept:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
