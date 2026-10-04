import { Router } from 'express';
import mongoose from 'mongoose';
import voiceRoutes from './voiceRoutes.js';
import inventoryRoutes from './inventoryRoutes.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'success',
    service: 'dukaan-sathi',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptimeSeconds: Math.round(process.uptime()),
  });
});

router.use('/voice', voiceRoutes);
router.use('/', inventoryRoutes);

export default router;
