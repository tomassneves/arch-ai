import { Router } from 'express';
import { refineModel } from '../llm.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { objectName, currentComposition, feedback, rating } = req.body;

    if (!objectName || !currentComposition) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required fields: objectName, currentComposition' 
      });
    }
    
    // Feedback text is optional if rating is provided
    if (!feedback && !rating) {
      return res.status(400).json({
        ok: false,
        error: 'Either feedback text or rating must be provided'
      });
    }

    const result = await refineModel(objectName, currentComposition, feedback, rating);

    res.json({ 
      ok: true, 
      spec: result 
    });
  } catch (error) {
    console.error('❌ Feedback error:', error.message);
    res.status(500).json({ 
      ok: false, 
      error: `Failed to improve object: ${error.message}` 
    });
  }
});

export default router;
