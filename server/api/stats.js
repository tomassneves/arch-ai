// stats.js - API endpoint for learning statistics
import express from 'express';
import { getLearningStats } from '../ai-learner.js';

const router = express.Router();

// Get learning statistics
router.get('/', async (req, res) => {
  try {
    const stats = getLearningStats();
    res.json(stats);
  } catch (err) {
    console.error('stats error', err);
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
