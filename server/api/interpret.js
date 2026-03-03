import { Router } from 'express';
import { runModel } from '../llm.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing or invalid text field' 
      });
    }

    const result = await runModel(text);

    res.json({ 
      ok: true, 
      spec: result 
    });
  } catch (error) {
    console.error('❌ Interpret error:', error.message);
    res.status(500).json({ 
      ok: false, 
      error: `Failed to generate 3D specification: ${error.message}` 
    });
  }
});

export default router;
