import { Router } from 'express';
import { refineModel } from '../llm.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { objectName, currentComposition, feedback, rating, storageOnly } = req.body;

    if (!objectName) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required field: objectName' 
      });
    }
    
    // Feedback text is optional if rating is provided
    if (!feedback && !rating) {
      return res.status(400).json({
        ok: false,
        error: 'Either feedback text or rating must be provided'
      });
    }
    
    // If storageOnly is true, just store the feedback without refining
    if (storageOnly) {
      console.log(`📝 Storing feedback for ${objectName}: "${feedback}"`);
      
      // TODO: Store feedback in database for future analysis/learning
      // For now, just log it
      
      return res.json({ 
        ok: true, 
        message: 'Feedback stored successfully',
        stored: true
      });
    }

    // Otherwise, refine the model based on the feedback
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
